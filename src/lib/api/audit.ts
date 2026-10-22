import { addAuditLog } from '@/lib/actions/audit'
import type { Caller } from '@/lib/mcp/auth'

const READ_ACTIONS = {
  list_records: 'API_LISTED_RECORDS',
  get_record: 'API_VIEWED_RECORD',
  search_records_semantic: 'API_SEARCHED_RECORDS',
  list_audit_log: 'API_VIEWED_AUDIT_LOG',
  list_email_deliveries: 'API_LISTED_EMAIL_DELIVERIES',
} as const

/** Las lecturas por API quedan en la auditoría igual que las del MCP. */
export async function logApiRead(
  tool: keyof typeof READ_ACTIONS,
  args: Record<string, unknown>,
  caller: Caller,
  recordId: string | null = null
) {
  try {
    await addAuditLog({
      userId: caller.id,
      userEmail: caller.email,
      userName: caller.name ?? caller.email,
      action: READ_ACTIONS[tool],
      recordId,
      details: { via: 'api', tool, apiKeyId: caller.via?.apiKeyId, apiKeyName: caller.via?.apiKeyName, args },
    })
  } catch (error) {
    console.error('[api] error registrando lectura en auditoría:', error)
  }
}
