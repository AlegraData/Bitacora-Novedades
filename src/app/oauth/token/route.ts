import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'
import { oauthCorsHeaders } from '@/lib/oauth/cors'
import {
  ACCESS_TTL_MS,
  REFRESH_TTL_MS,
  generateToken,
  refreshSession,
  logRejection,
  limiterKey,
  retryAfterSeconds,
  recordFailure,
  recordSuccess,
} from '@/lib/oauth/refresh'

const MAX_BODY_CHARS = 8 * 1024

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
  const accessToken = generateToken()
  const refreshToken = generateToken()
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
  // RFC 6749 §5.1: las respuestas del endpoint de tokens no deben guardarse en ninguna caché.
  const headers = { ...oauthCorsHeaders(), 'Cache-Control': 'no-store', Pragma: 'no-cache' }
  const invalidRequest = () => NextResponse.json({ error: 'invalid_request' }, { status: 400, headers })

  const raw = await request.text()
  if (raw.length > MAX_BODY_CHARS) return invalidRequest()

  const contentType = request.headers.get('content-type') ?? ''
  let params: URLSearchParams
  if (contentType.includes('application/json')) {
    let body: unknown = {}
    try {
      body = JSON.parse(raw)
    } catch {
      return invalidRequest()
    }
    params = new URLSearchParams(
      body && typeof body === 'object' && !Array.isArray(body)
        ? Object.entries(body).map(([k, v]) => [k, String(v)])
        : []
    )
  } else {
    params = new URLSearchParams(raw)
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
    const refreshToken = params.get('refresh_token')
    const clientId = params.get('client_id')
    if (!refreshToken) return invalidRequest()

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
    const userAgent = request.headers.get('user-agent')
    const key = limiterKey(ip, clientId)

    // Un cliente que insiste con credenciales inválidas recibe 429 con Retry-After en vez de golpear la base cada pocos segundos.
    const wait = retryAfterSeconds(key)
    if (wait > 0) {
      logRejection('revoked', clientId, userAgent, true)
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Too many failed attempts — wait and re-authenticate' },
        { status: 429, headers: { ...headers, 'Retry-After': String(wait) } }
      )
    }

    const result = await refreshSession(refreshToken, clientId)
    if (!result.ok) {
      recordFailure(key)
      logRejection(result.reason, clientId, userAgent)
      // La respuesta no revela el motivo (token inexistente, revocado, de otro cliente): solo el vencimiento, que el
      // usuario debe poder entender para volver a autorizar.
      return NextResponse.json(
        result.reason === 'expired'
          ? { error: 'invalid_grant', error_description: 'Refresh token expired — please re-authenticate' }
          : { error: 'invalid_grant' },
        { status: 400, headers }
      )
    }

    recordSuccess(key)
    return NextResponse.json(
      {
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_type: 'Bearer',
        expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      },
      { headers }
    )
  }

  return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400, headers })
}
