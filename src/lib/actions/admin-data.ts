'use server'

import { requireAdmin } from '@/lib/auth-utils'
import { queryAuditLogs, type AuditFilters, type AuditPageDTO } from '@/lib/admin/audit'
import { getApiOverview, getApiActivity, type ApiOverviewDTO, type ApiActivityFilters, type ApiActivityPage } from '@/lib/admin/api-dashboard'
import { getMcpOverview, getMcpActivity, type McpOverviewDTO, type McpActivityFilters, type McpActivityPage } from '@/lib/admin/mcp-dashboard'

// Datos de las pestañas del panel de administración que se consultan por páginas. Todas exigen ADMIN.

export async function getAuditPage(filters: AuditFilters): Promise<AuditPageDTO> {
  await requireAdmin()
  return queryAuditLogs(filters)
}

export async function getMcpOverviewAction(period: number): Promise<McpOverviewDTO> {
  await requireAdmin()
  return getMcpOverview(period)
}

export async function getMcpActivityPage(filters: McpActivityFilters): Promise<McpActivityPage> {
  await requireAdmin()
  return getMcpActivity(filters)
}

export async function getApiOverviewAction(period: number): Promise<ApiOverviewDTO> {
  await requireAdmin()
  return getApiOverview(period)
}

export async function getApiActivityPage(filters: ApiActivityFilters): Promise<ApiActivityPage> {
  await requireAdmin()
  return getApiActivity(filters)
}
