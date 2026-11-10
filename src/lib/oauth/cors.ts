export function oauthCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    // Sin esto un cliente MCP en el navegador no puede leer WWW-Authenticate (y no descubre cómo autenticarse).
    'Access-Control-Expose-Headers': 'WWW-Authenticate',
  }
}
