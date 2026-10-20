import { handleListAuditLog } from '@/lib/mcp/tools'
import { apiRoute, apiJson, apiError, toolResultResponse } from '@/lib/api/http'
import { parseQuery, QueryError } from '@/lib/api/query'
import { logApiRead } from '@/lib/api/audit'

export const GET = apiRoute('audit:read', async ({ request, caller }) => {
  try {
    const args = parseQuery(request.nextUrl.searchParams, ['recordId', 'userId', 'desde', 'hasta', 'limit'])
    const result = await handleListAuditLog(args)
    if (result.error) return toolResultResponse(result)
    await logApiRead('list_audit_log', args, caller)
    return apiJson(result)
  } catch (e) {
    if (e instanceof QueryError) return apiError(400, 'invalid_request', e.message)
    throw e
  }
})
