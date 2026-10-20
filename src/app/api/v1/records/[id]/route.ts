import { handleGetRecord } from '@/lib/mcp/tools'
import { apiRoute, apiJson, apiError, toolResultResponse } from '@/lib/api/http'
import { parseQuery, parseFields, project, QueryError } from '@/lib/api/query'
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
