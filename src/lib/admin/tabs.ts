// Pestañas del panel de administración (puro, sin React): ids, grupos y lectura de la URL.

export const ADMIN_TABS = ['users', 'permissions', 'audit', 'mcp', 'api', 'communication', 'email'] as const
export type AdminTab = (typeof ADMIN_TABS)[number]

export const DEFAULT_TAB: AdminTab = 'users'

export const TAB_GROUPS: { label: string; tabs: AdminTab[] }[] = [
  { label: 'Accesos', tabs: ['users', 'permissions', 'audit'] },
  { label: 'Integraciones', tabs: ['mcp', 'api'] },
  { label: 'Comunicación', tabs: ['communication', 'email'] },
]

export const TAB_LABELS: Record<AdminTab, string> = {
  users: 'Usuarios',
  permissions: 'Permisos de campos',
  audit: 'Auditoría',
  mcp: 'Conexiones MCP',
  api: 'API Tokens',
  communication: 'Comunicación',
  email: 'Correos',
}

/** Lee la pestaña de la URL (`#audit` o `#tab=audit`); cualquier valor desconocido vuelve a la de por defecto. */
export function tabFromHash(hash: string | null | undefined): AdminTab {
  const v = String(hash ?? '').replace(/^#/, '').replace(/^tab=/, '').trim()
  return (ADMIN_TABS as readonly string[]).includes(v) ? (v as AdminTab) : DEFAULT_TAB
}
