import { handleGetRecord, handleUpdateRecord, handleDeleteRecord } from '@/lib/mcp/tools'
import { apiRoute, apiJson, apiError, toolResultResponse } from '@/lib/api/http'
import { parseQuery, parseFields, project, QueryError } from '@/lib/api/query'
import { readJsonObject, BodyError } from '@/lib/api/body'
import { logApiRead } from '@/lib/api/audit'

export const GET = apiRoute('records:read', async ({ request, caller, params }) => {
  try {
    parseQuery(request.nextUrl.searchParams, [])
    const fields = parseFields(request.nextUrl.searchParams)

    const result = await handleGetRecord({ id: params.id })
    if (result.error) return toolResultResponse(result)
    await logApiRead('get_record', {}, caller, params.id)

    return apiJson(project(result, fields))
  } catch (e) {
    if (e instanceof QueryError) return apiError(400, 'invalid_request', e.message)
    throw e
  }
})

/** Solo se envían los campos que cambian. El id siempre sale de la URL, nunca del body. */
export const PATCH = apiRoute('records:write', async ({ request, caller, params }) => {
  try {
    const body = await readJsonObject(request)
    return toolResultResponse(await handleUpdateRecord({ ...body, id: params.id }, caller))
  } catch (e) {
    if (e instanceof BodyError) return apiError(e.status, e.code, e.message)
    throw e
  }
})

/** Mismo criterio que el MCP: eliminar es irreversible y está reservado al rol ADMIN. */
export const DELETE = apiRoute('records:delete', async ({ caller, params }) => {
  if (caller.role !== 'ADMIN') {
    return apiError(403, 'forbidden', 'Eliminar registros requiere que el dueño del token tenga rol ADMIN.')
  }
  return toolResultResponse(await handleDeleteRecord({ id: params.id }, caller))
})
