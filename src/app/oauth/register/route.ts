import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { oauthCorsHeaders } from '@/lib/oauth/cors'

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: oauthCorsHeaders() })
}

function isAllowedRedirectUri(uri: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return false
  }
  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  return parsed.protocol === 'https:' || isLoopback
}

export async function POST(request: NextRequest) {
  const headers = oauthCorsHeaders()
  const body = await request.json().catch(() => null)

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400, headers })
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u: unknown): u is string => typeof u === 'string')
    : []

  if (redirectUris.length === 0 || !redirectUris.every(isAllowedRedirectUri)) {
    return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400, headers })
  }

  const name = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim() : 'MCP Client'
  const clientId = randomBytes(16).toString('base64url')

  await prisma.oAuthClient.create({
    data: { clientId, name, redirectUris },
  })

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    { status: 201, headers }
  )
}
