import { buildOpenApi } from '@/lib/api/docs'

// Documentación pública (sin datos ni secretos): describe el contrato, no expone registros.
export function GET() {
  return Response.json(buildOpenApi(), { headers: { 'Cache-Control': 'public, max-age=300' } })
}
