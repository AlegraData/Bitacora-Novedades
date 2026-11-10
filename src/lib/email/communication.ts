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

export const TIPO_NO_COMUNICABLE = 'Este tipo de novedad no está habilitado para comunicarse. Un administrador puede habilitarlo desde Admin → Comunicación.'

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

// ---------- Reglas por tipo (TMDIAPD-65) ----------

/** AUTO: sale sola al completarse | MANUAL: solo con una acción explícita | DISABLED: no se puede enviar. */
export type CommunicationMode = 'AUTO' | 'MANUAL' | 'DISABLED'
export const COMMUNICATION_MODES: CommunicationMode[] = ['AUTO', 'MANUAL', 'DISABLED']

export const MODE_LABELS: Record<CommunicationMode, string> = {
  AUTO: 'Automático',
  MANUAL: 'Manual habilitado',
  DISABLED: 'Deshabilitado',
}

export interface CommunicationRule {
  tipo: string
  mode: CommunicationMode
  /** Claves lógicas (titulo, breveDescripcion…) que deben estar completas para comunicar. */
  requiredFields: string[]
  /** Solo en AUTO: no se envía sola ninguna novedad creada antes de esta fecha (ISO). null = sin límite propio. */
  autoSince: string | null
}

/** Criterio de hoy: los obligatorios base más «¿Trae video?» (y «Video» si es Sí). */
export const DEFAULT_REQUIRED_FIELDS: string[] = [...BASE_REQUIRED_FIELDS.map((f) => f.key), 'traeVideo']

/** Reglas de fábrica (las que regían antes del panel): Novedad y Pre-novedad en automático, el resto deshabilitado. */
export const DEFAULT_RULES: CommunicationRule[] = COMMUNICABLE_TIPOS.map((tipo) => ({
  tipo,
  mode: 'AUTO' as const,
  requiredFields: DEFAULT_REQUIRED_FIELDS,
  autoSince: null,
}))

/** Campos de la Bitácora que un administrador puede exigir (todos los lógicos salvo los que no tienen sentido). */
const NOT_REQUIRABLE = new Set(['tipo', 'urlBitacora', 'status'])
export const REQUIRABLE_FIELDS: { key: string; label: string }[] = Object.entries(LOGICAL_FIELD_NAMES)
  .filter(([key]) => !NOT_REQUIRABLE.has(key))
  .map(([key, label]) => ({ key, label }))

export function isRequirableField(key: unknown): key is string {
  return typeof key === 'string' && REQUIRABLE_FIELDS.some((f) => f.key === key)
}

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

/** Normaliza un tipo para compararlo: sin tildes, mayúsculas ni guiones («Pre novedad» y «Pre-novedad» son el mismo). */
export function tipoKey(tipo: unknown): string {
  return norm(Array.isArray(tipo) ? tipo[0] : tipo).replace(/[-_\s]+/g, ' ')
}

/** La regla que aplica a un tipo. Un tipo sin regla se trata como deshabilitado (lo seguro). */
export function findRule(rules: CommunicationRule[], tipo: unknown): CommunicationRule | null {
  const k = tipoKey(tipo)
  return k === '' ? null : (rules.find((r) => tipoKey(r.tipo) === k) ?? null)
}

/** ¿El tipo se puede comunicar (automática o manualmente)? */
export function isCommunicableTipo(tipo: unknown, rules: CommunicationRule[] = DEFAULT_RULES): boolean {
  const rule = findRule(rules, tipo)
  return !!rule && rule.mode !== 'DISABLED'
}

/** ¿Esta novedad debe salir sola? Solo en modo AUTO y sin retroactivos (corte global y corte propio de la regla). */
export function shouldAutoSend(rule: CommunicationRule | null, createdAt: Date | string): boolean {
  if (!rule || rule.mode !== 'AUTO') return false
  const created = new Date(createdAt).getTime()
  const since = Math.max(COMMUNICATION_SINCE.getTime(), rule.autoSince ? new Date(rule.autoSince).getTime() : 0)
  return created >= since
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
 * `requiredFields`: el criterio de la regla del tipo (por defecto, el de fábrica).
 * `traeVideoConfigured`: si el campo «¿Trae video?» aún no existe en la Bitácora la regla se omite, para
 * que desplegar antes de crearlo no deje todas las novedades pendientes.
 * «traeVideo» es un criterio compuesto: exige elegir Sí/No y, si es Sí, también el Video.
 */
export function evaluateCommunication(logical: Record<string, unknown>, opts: { traeVideoConfigured: boolean; requiredFields?: string[] }): CommunicationCheck {
  const required = opts.requiredFields ?? DEFAULT_REQUIRED_FIELDS
  const missing = required
    .filter((key) => key !== 'traeVideo' && isMissing(logical[key]))
    .map((key) => LOGICAL_FIELD_NAMES[key] ?? key)

  if (opts.traeVideoConfigured && required.includes('traeVideo')) {
    const answer = traeVideoAnswer(logical.traeVideo)
    if (answer === null) missing.push(MISSING_TRAE_VIDEO)
    // Si «Video» ya es obligatorio por sí solo no se repite el aviso.
    else if (answer === 'yes' && !required.includes('video') && isMissing(logical.video)) missing.push(MISSING_VIDEO)
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
