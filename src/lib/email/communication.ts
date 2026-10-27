import { LOGICAL_FIELD_NAMES } from '@/lib/field-names'

// Reglas para decidir si una novedad ya se puede comunicar (TMDIAPD-56). Módulo puro, sin dependencias
// de servidor: lo usan el servicio de envío (para enviar o no) y la pantalla (para mostrar «Pendiente»).

/**
 * El envío automático solo aplica a registros creados desde esta fecha (el despliegue de TMDIAPD-56):
 * al abrir todos los tipos no se dispara nada retroactivo sobre registros anteriores.
 */
export const COMMUNICATION_SINCE = new Date('2026-10-23T00:38:00.000Z')

/**
 * Tipos que se comunican a PMKT (decisión final de PMKT). Los demás (Mejora, Experimento, Novedades pequeñas…)
 * no se envían ni automática ni manualmente. Para abrir otro tipo en el futuro basta con agregarlo aquí.
 */
export const COMMUNICABLE_TIPOS = ['Novedad', 'Pre-novedad']

export const TIPO_NO_COMUNICABLE = 'Este tipo de novedad no se comunica a PMKT: solo se envían las Novedades y las Pre-novedades.'

export const MISSING_TRAE_VIDEO = '¿Trae video? (elige Sí o No)'
export const MISSING_VIDEO = 'Video (marcaste «¿Trae video?» = Sí)'

/** Campos obligatorios para comunicar, para todos los tipos de novedad. */
export const BASE_REQUIRED_FIELDS: { key: string; label: string }[] = [
  { key: 'titulo', label: 'Título' },
  { key: 'breveDescripcion', label: 'Breve descripción' },
  { key: 'fechaLanzamiento', label: 'Fecha de lanzamiento' },
  { key: 'fechaProduccion', label: 'Fecha real de producción' },
  { key: 'responsables', label: 'Responsables' },
]

export function isMissing(v: unknown): boolean {
  if (Array.isArray(v)) return v.every(isMissing)
  if (typeof v === 'boolean') return false
  return v === undefined || v === null || String(v).trim() === ''
}

function norm(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

/** ¿El tipo se comunica? Compara sin tildes, mayúsculas ni guiones («Pre novedad» y «Pre-novedad» son el mismo). */
export function isCommunicableTipo(tipo: unknown): boolean {
  const key = (v: unknown) => norm(v).replace(/[-_\s]+/g, ' ')
  const t = key(Array.isArray(tipo) ? tipo[0] : tipo)
  return t !== '' && COMMUNICABLE_TIPOS.some((c) => key(c) === t)
}

/** «Sí» / «No» del campo «¿Trae video?» (acepta mayúsculas, tildes y booleanos). null = sin elegir. */
export function traeVideoAnswer(v: unknown): 'yes' | 'no' | null {
  if (v === true) return 'yes'
  if (v === false) return 'no'
  const s = norm(Array.isArray(v) ? v[0] : v)
  if (['si', 'yes', 'true', '1'].includes(s)) return 'yes'
  if (['no', 'false', '0'].includes(s)) return 'no'
  return null
}

export interface CommunicationCheck {
  ready: boolean
  /** Qué falta, con el nombre del campo tal como lo ve el usuario. */
  missing: string[]
}

/**
 * `logical` usa las claves lógicas del MCP (titulo, breveDescripcion, traeVideo…).
 * `traeVideoConfigured`: si el campo «¿Trae video?» aún no existe en la Bitácora la regla se omite, para
 * que desplegar antes de crearlo no deje todas las novedades pendientes.
 */
export function evaluateCommunication(logical: Record<string, unknown>, opts: { traeVideoConfigured: boolean }): CommunicationCheck {
  const missing = BASE_REQUIRED_FIELDS.filter(({ key }) => isMissing(logical[key])).map(({ label }) => label)

  if (opts.traeVideoConfigured) {
    const answer = traeVideoAnswer(logical.traeVideo)
    if (answer === null) missing.push(MISSING_TRAE_VIDEO)
    else if (answer === 'yes' && isMissing(logical.video)) missing.push(MISSING_VIDEO)
  }
  return { ready: missing.length === 0, missing }
}

/**
 * Arma el objeto «lógico» de un registro a partir de sus datos (por id de campo) y la lista de campos
 * (por nombre). Es lo que hace el servidor con mapRecordData, pero sin tocar la base: sirve en el cliente.
 */
export function logicalFromFields(data: Record<string, unknown>, fields: { id: string; name: string }[]): Record<string, unknown> {
  const byName = new Map(fields.map((f) => [f.name.toLowerCase().trim(), f.id]))
  const out: Record<string, unknown> = {}
  for (const [key, name] of Object.entries(LOGICAL_FIELD_NAMES)) {
    const id = byName.get(name.toLowerCase().trim())
    if (id && data[id] !== undefined) out[key] = data[id]
  }
  return out
}

export function hasTraeVideoField(fields: { name: string }[]): boolean {
  const target = LOGICAL_FIELD_NAMES.traeVideo.toLowerCase()
  return fields.some((f) => f.name.toLowerCase().trim() === target)
}

/** Reenviar una novedad ya comunicada exige un motivo, para dejar constancia en el historial. */
export const MIN_RESEND_REASON = 10
export const MAX_RESEND_REASON = 500

/** Devuelve el motivo limpio, o null si no cumple el largo mínimo/máximo. */
export function normalizeResendReason(reason: unknown): string | null {
  if (typeof reason !== 'string') return null
  const r = reason.trim()
  return r.length >= MIN_RESEND_REASON && r.length <= MAX_RESEND_REASON ? r : null
}
