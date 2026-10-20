import { handleSearchRecordsSemantic } from '@/lib/mcp/tools'
import { apiRoute, apiJson, apiError, toolResultResponse } from '@/lib/api/http'
import { parseQuery, parseFields, project, QueryError } from '@/lib/api/query'
import { logApiRead } from '@/lib/api/audit'

export const GET = apiRoute('records:read', async ({ request, caller }) => {
  try {
    const params = request.nextUrl.searchParams
    const args = parseQuery(params, ['q', 'limit', 'producto', 'fechaLanzamientoDesde', 'fechaLanzamientoHasta'])
    const fields = parseFields(params)

    const { q, ...rest } = args
    if (typeof q !== 'string' || !q.trim()) return apiError(400, 'invalid_request', 'El parámetro "q" es obligatorio.')
    if (q.length > 500) return apiError(400, 'invalid_request', 'El parámetro "q" admite máximo 500 caracteres.')

    const result = await handleSearchRecordsSemantic({ ...rest, query: q })
    if (result.error) return toolResultResponse(result)
    await logApiRead('search_records_semantic', { ...rest, query: q }, caller)

    return apiJson({ results: (result.results as Record<string, unknown>[]).map((r) => project(r, fields)) })
  } catch (e) {
    if (e instanceof QueryError) return apiError(400, 'invalid_request', e.message)
    throw e
  }
})
