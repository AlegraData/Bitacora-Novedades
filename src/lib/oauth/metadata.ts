// Metadatos OAuth de Bitácora (RFC 9728): los clientes MCP los usan para descubrir el servidor de autorización.
// El 401 del MCP y los documentos .well-known se arman aquí para que apunten siempre a las mismas URLs.
import { getPublicOrigin } from '@/lib/get-public-origin'

export const MCP_PATH = '/api/mcp'
export const RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`

/**
 * Origen público de la petición, normalizado: `new URL(...).origin` deja solo esquema y host en ASCII (punycode), de modo
 * que nada que venga de x-forwarded-* pueda colar caracteres raros en un encabezado. Si no es válido, se usa APP_PUBLIC_URL.
 */
export function publicOrigin(headers: Headers, requestUrl?: string): string {
  const candidates = [getPublicOrigin(headers, requestUrl), process.env.APP_PUBLIC_URL, 'http://localhost:3000']
  for (const c of candidates) {
    if (!c) continue
    try {
      const u = new URL(c)
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin
    } catch {
      // pasa al siguiente candidato
    }
  }
  return 'http://localhost:3000'
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
  }
}

/** Valor de WWW-Authenticate del 401: conserva el esquema Bearer y añade dónde descubrir el servidor de autorización. Solo ASCII. */
export function wwwAuthenticate(origin: string): string {
  return `Bearer realm="Bitacora Novedades MCP", resource_metadata="${origin}${RESOURCE_METADATA_PATH}"`
}
