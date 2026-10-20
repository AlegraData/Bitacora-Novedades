import { handleListRecords, handleCreateRecord } from '@/lib/mcp/tools'
import { apiRoute, apiJson, apiError, toolResultResponse } from '@/lib/api/http'
import { parseQuery, parseFields, project, QueryError } from '@/lib/api/query'
import { readJsonObject, BodyError } from '@/lib/api/body'
import { logApiRead } from '@/lib/api/audit'

const LIST_PARAMS = [
  'tipo', 'status', 'producto', 'sh', 'elaborado', 'responsables', 'necesitaComunicacionPMKT',
  'fechaLanzamientoDesde', 'fechaLanzamientoHasta', 'fechaProduccionDesde', 'fechaProduccionHasta',
  'proyectoLinear', 'query', 'limit', 'offset',
]

export const GET = apiRoute('records:read', async ({ request, caller }) => {
  try {
    const params = request.nextUrl.searchParams
    const args = parseQuery(params, LIST_PARAMS)
    const fields = parseFields(params)

    const result = await handleListRecords(args)
    if (result.error) return toolResultResponse(result)
    await logApiRead('list_records', args, caller)

    return apiJson({ ...result, records: (result.records as Record<string, unknown>[]).map((r) => project(r, fields)) })
  } catch (e) {
    if (e instanceof QueryError) return apiError(400, 'invalid_request', e.message)
    throw e
  }
})

export const POST = apiRoute('records:write', async ({ request, caller }) => {
  try {
    const body = await readJsonObject(request)
    return toolResultResponse(await handleCreateRecord(body, caller), 201)
  } catch (e) {
    if (e instanceof BodyError) return apiError(e.status, e.code, e.message)
    throw e
  }
})
