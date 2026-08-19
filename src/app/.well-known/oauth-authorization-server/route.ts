import { NextRequest, NextResponse } from 'next/server'
import { getPublicOrigin } from '@/lib/get-public-origin'
import { oauthCorsHeaders } from '@/lib/oauth/cors'

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: oauthCorsHeaders() })
}

export async function GET(request: NextRequest) {
  const origin = getPublicOrigin(request.headers, request.url)

  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    },
    { headers: oauthCorsHeaders() }
  )
}
