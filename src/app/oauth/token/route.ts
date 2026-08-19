import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, createHash, timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'
import { oauthCorsHeaders } from '@/lib/oauth/cors'

const ACCESS_TTL_MS = 15 * 60 * 1000
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: oauthCorsHeaders() })
}

function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = Buffer.from(createHash('sha256').update(codeVerifier).digest('base64url'))
  const expected = Buffer.from(codeChallenge)
  if (computed.length !== expected.length) return false
  return timingSafeEqual(computed, expected)
}

async function issueSession(clientId: string, clientName: string | undefined, userEmail: string) {
  const accessToken = randomBytes(32).toString('base64url')
  const refreshToken = randomBytes(32).toString('base64url')
  const now = Date.now()

  await prisma.oAuthSession.create({
    data: {
      accessToken,
      refreshToken,
      userEmail,
      clientId,
      clientName,
      expiresAt: new Date(now + ACCESS_TTL_MS),
      refreshExpiresAt: new Date(now + REFRESH_TTL_MS),
    },
  })

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
  }
}

export async function POST(request: NextRequest) {
  const headers = oauthCorsHeaders()
  const contentType = request.headers.get('content-type') ?? ''

  let params: URLSearchParams
  if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => ({}))
    params = new URLSearchParams(
      Object.entries(body).map(([k, v]) => [k, String(v)])
    )
  } else {
    params = new URLSearchParams(await request.text())
  }

  const grantType = params.get('grant_type')

  if (grantType === 'authorization_code') {
    const code = params.get('code') ?? ''
    const redirectUri = params.get('redirect_uri') ?? ''
    const codeVerifier = params.get('code_verifier') ?? ''
    const clientId = params.get('client_id') ?? ''

    const oauthCode = await prisma.oAuthCode.findUnique({ where: { code } })

    const isValid =
      oauthCode &&
      oauthCode.expiresAt > new Date() &&
      oauthCode.clientId === clientId &&
      oauthCode.redirectUri === redirectUri &&
      codeVerifier &&
      verifyPkce(codeVerifier, oauthCode.codeChallenge)

    if (!isValid) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400, headers })
    }

    await prisma.oAuthCode.delete({ where: { code } }).catch(() => {})

    const client = await prisma.oAuthClient.findUnique({ where: { clientId } })
    const tokens = await issueSession(clientId, client?.name, oauthCode.userEmail)
    return NextResponse.json(tokens, { headers })
  }

  if (grantType === 'refresh_token') {
    const refreshToken = params.get('refresh_token') ?? ''
    const session = await prisma.oAuthSession.findUnique({ where: { refreshToken } })

    if (!session || session.revokedAt || session.refreshExpiresAt < new Date()) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400, headers })
    }

    await prisma.oAuthSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
    const tokens = await issueSession(session.clientId, session.clientName ?? undefined, session.userEmail)
    return NextResponse.json(tokens, { headers })
  }

  return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400, headers })
}
