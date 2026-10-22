import { apiRoute, apiJson, apiError } from '@/lib/api/http'
import { parseQuery, isValidId, QueryError } from '@/lib/api/query'
import { listDeliveries } from '@/lib/email/history'
import { logApiRead } from '@/lib/api/audit'

/** Historial de envíos de correo de una novedad: quién, cuándo, con qué resultado y por qué falló. */
export const GET = apiRoute('records:read', async ({ request, caller, params }) => {
  if (!isValidId(params.id)) return apiError(404, 'not_found', 'Registro no encontrado.')
  try {
    const args = parseQuery(request.nextUrl.searchParams, ['status', 'mode', 'limit', 'offset'])
    const result = await listDeliveries(caller.role, { ...args, recordId: params.id })
    await logApiRead('list_email_deliveries', { ...args }, caller, params.id)
    return apiJson(result)
  } catch (e) {
    if (e instanceof QueryError) return apiError(400, 'invalid_request', e.message)
    throw e
  }
})
