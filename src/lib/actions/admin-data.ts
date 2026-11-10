'use server'

import { requireAdmin } from '@/lib/auth-utils'
import { queryAuditLogs, type AuditFilters, type AuditPageDTO } from '@/lib/admin/audit'

// Datos de las pestañas del panel de administración que se consultan por páginas. Todas exigen ADMIN.

export async function getAuditPage(filters: AuditFilters): Promise<AuditPageDTO> {
  await requireAdmin()
  return queryAuditLogs(filters)
}
