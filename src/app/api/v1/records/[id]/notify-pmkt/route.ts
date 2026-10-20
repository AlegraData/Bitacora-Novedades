import { handleNotifyPmkt } from '@/lib/mcp/tools'
import { apiRoute, apiError, toolResultResponse } from '@/lib/api/http'
import { readJsonObject, BodyError } from '@/lib/api/body'
import { isValidId } from '@/lib/api/query'

/**
 * Fallback manual de la comunicación a PMKT (la normal es automática).
 * Sin `confirm: true` solo devuelve un preview y no envía nada.
 */
export const POST = apiRoute('pmkt:notify', async ({ request, caller, params }) => {
  if (!isValidId(params.id)) return apiError(404, 'not_found', 'Registro no encontrado.')
  try {
    const hasBody = (request.headers.get('content-length') ?? '0') !== '0'
    const body = hasBody ? await readJsonObject(request) : {}
    if (body.confirm !== undefined && typeof body.confirm !== 'boolean') {
      return apiError(400, 'invalid_request', '"confirm" debe ser booleano.')
    }
    return toolResultResponse(await handleNotifyPmkt({ recordId: params.id, confirm: body.confirm === true }, caller))
  } catch (e) {
    if (e instanceof BodyError) return apiError(e.status, e.code, e.message)
    throw e
  }
})
