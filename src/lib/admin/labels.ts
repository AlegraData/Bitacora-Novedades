// Nombres legibles de las herramientas del MCP y de los resultados, para los dashboards del admin.

export const MCP_TOOL_LABELS: Record<string, string> = {
  list_records: 'Listar novedades',
  get_record: 'Ver novedad',
  search_records_semantic: 'Búsqueda semántica',
  create_record: 'Crear novedad',
  update_record: 'Editar novedad',
  delete_record: 'Eliminar novedad',
  notify_pmkt: 'Comunicar a PMKT',
  list_audit_log: 'Ver auditoría',
  list_email_deliveries: 'Ver envíos de correo',
}

export const toolLabel = (tool: string) => MCP_TOOL_LABELS[tool] ?? tool

export const RESULT_LABELS: Record<string, string> = { ok: 'Correcta', denied: 'Denegada', error: 'Error' }

/** «hace 2 min», «hace 3 h», «hace 4 d»; «—» si no hay fecha. */
export function timeAgo(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return 'Nunca'
  const diff = Math.max(0, nowMs - new Date(iso).getTime())
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return d < 30 ? `hace ${d} d` : new Date(iso).toLocaleDateString('es-CO')
}
