import { handleNotifyPmkt } from '@/lib/mcp/tools'
import { apiRoute, apiJson, apiError } from '@/lib/api/http'
import { readJsonObject, BodyError } from '@/lib/api/body'
import { isValidId } from '@/lib/api/query'
import { HTTP_STATUS, type EmailErrorCode } from '@/lib/email/errors'

/**
 * Fallback manual de la comunicación (la normal es automática).
 * Sin `confirm: true` solo simula: devuelve el correo exacto sin enviar nada.
 * La respuesta siempre trae `status` (sent | simulated | failed | skipped) y, si falló,
 * `error.code` / `error.message` con el motivo; el estado HTTP sale de ese código.
 */
export const POST = apiRoute('pmkt:notify', async ({ request, caller, params }) => {
  if (!isValidId(params.id)) return apiError(404, 'not_found', 'Registro no encontrado.')
  try {
    // content-length no siempre viene (transferencia por chunks): si hay content-type, hay body.
    const hasBody = request.headers.has('content-type') || Number(request.headers.get('content-length') ?? 0) > 0
    const body = hasBody ? await readJsonObject(request) : {}
    for (const key of ['confirm', 'resend'] as const) {
      if (body[key] !== undefined && typeof body[key] !== 'boolean') {
        return apiError(400, 'invalid_request', `"${key}" debe ser booleano.`)
      }
    }
    if (body.reason !== undefined && typeof body.reason !== 'string') {
      return apiError(400, 'invalid_request', '"reason" debe ser texto.')
    }

    const result = await handleNotifyPmkt(
      { recordId: params.id, confirm: body.confirm === true, resend: body.resend === true, reason: body.reason },
      caller
    )
    const error = result.error as { code?: EmailErrorCode } | undefined
    return apiJson(result, result.ok === false ? (error?.code ? HTTP_STATUS[error.code] : 500) : 200)
  } catch (e) {
    if (e instanceof BodyError) return apiError(e.status, e.code, e.message)
    throw e
  }
})
