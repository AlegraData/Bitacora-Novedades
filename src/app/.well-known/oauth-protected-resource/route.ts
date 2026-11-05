import { NextRequest, NextResponse } from 'next/server'
import { oauthCorsHeaders } from '@/lib/oauth/cors'
import { protectedResourceMetadata, publicOrigin } from '@/lib/oauth/metadata'

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: oauthCorsHeaders() })
}

// RFC 9728: metadatos públicos (sin secretos) para que los clientes MCP descubran el servidor de autorización.
export async function GET(request: NextRequest) {
  return NextResponse.json(protectedResourceMetadata(publicOrigin(request.headers, request.url)), {
    headers: { ...oauthCorsHeaders(), 'Cache-Control': 'public, max-age=3600' },
  })
}
