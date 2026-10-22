import { apiRoute, apiJson, apiError } from '@/lib/api/http'
import { parseQuery, QueryError } from '@/lib/api/query'
import { listDeliveries } from '@/lib/email/history'
import { logApiRead } from '@/lib/api/audit'

/** Historial de envíos de toda la Bitácora (requiere audit:read). */
export const GET = apiRoute('audit:read', async ({ request, caller }) => {
  try {
    const args = parseQuery(request.nextUrl.searchParams, ['recordId', 'status', 'mode', 'limit', 'offset'])
    const result = await listDeliveries(caller.role, args)
    await logApiRead('list_email_deliveries', args, caller)
    return apiJson(result)
  } catch (e) {
    if (e instanceof QueryError) return apiError(400, 'invalid_request', e.message)
    throw e
  }
})
