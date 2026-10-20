import { LOGICAL_FIELD_NAMES } from '@/lib/mcp/fields'

export class QueryError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const LIST_PARAMS = new Set(['producto', 'responsables'])
const DATE_PARAMS = new Set([
  'fechaLanzamientoDesde', 'fechaLanzamientoHasta', 'fechaProduccionDesde', 'fechaProduccionHasta', 'desde', 'hasta',
])
const INT_PARAMS = new Set(['limit', 'offset'])

const PROJECTABLE = new Set([
  'id', 'createdAt', 'updatedAt', 'createdByEmail', 'createdByName', 'distance', 'contenido',
  ...Object.keys(LOGICAL_FIELD_NAMES),
])

/**
 * Convierte la query string en el objeto `args` que esperan los handlers
 * compartidos con el MCP. Solo pasan los parámetros de `allowed`; el resto se
 * rechaza para que un typo no devuelva datos sin filtrar sin avisar.
 */
export function parseQuery(params: URLSearchParams, allowed: string[]): Record<string, unknown> {
  const allow = new Set([...allowed, 'fields'])
  const args: Record<string, unknown> = {}

  for (const key of new Set(params.keys())) {
    if (!allow.has(key)) throw new QueryError(`Parámetro desconocido: "${key}".`)
    if (key === 'fields') continue
    const values = params.getAll(key)
    // Postgres no admite el byte NUL en strings: llegaría como error 500 en vez de 400.
    if (values.some((v) => v.includes('\0'))) throw new QueryError(`"${key}" contiene caracteres no permitidos.`)

    if (LIST_PARAMS.has(key)) {
      args[key] = values.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean)
      continue
    }
    const value = values[values.length - 1]
    if (INT_PARAMS.has(key)) {
      if (!/^\d{1,6}$/.test(value)) throw new QueryError(`"${key}" debe ser un entero positivo.`)
      args[key] = Number(value)
    } else if (DATE_PARAMS.has(key)) {
      if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) throw new QueryError(`"${key}" debe tener formato YYYY-MM-DD.`)
      args[key] = value
    } else {
      args[key] = value
    }
  }
  return args
}

export function parseFields(params: URLSearchParams): string[] | null {
  const raw = params.getAll('fields').flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean)
  if (raw.length === 0) return null
  const unknown = raw.filter((f) => !PROJECTABLE.has(f))
  if (unknown.length > 0) throw new QueryError(`Campos desconocidos en "fields": ${unknown.join(', ')}.`)
  return Array.from(new Set(['id', ...raw]))
}

export function project<T extends Record<string, unknown>>(row: T, fields: string[] | null): Partial<T> {
  if (!fields) return row
  return Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, row[f]])) as Partial<T>
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** Los ids son cuid; cualquier otra forma no puede existir, así que se responde 404 sin tocar la BD. */
export function isValidId(id: string): boolean {
  return ID_RE.test(id)
}
