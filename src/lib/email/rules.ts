import { prisma } from '@/lib/prisma'
import { addAuditLog } from '@/lib/actions/audit'
import { EmailSendError } from './errors'
import {
  COMMUNICATION_MODES, DEFAULT_RULES, DEFAULT_REQUIRED_FIELDS, isRequirableField, tipoKey,
  type CommunicationMode, type CommunicationRule,
} from './communication'
import type { SettingsActor } from './settings'

// Reglas de comunicación por tipo (TMDIAPD-65). La tabla CommunicationRule tiene una fila por tipo configurado;
// lo que no tiene fila usa los valores de fábrica (DEFAULT_RULES) y, si tampoco existe ahí, queda deshabilitado.

function bad(message: string): never {
  throw new EmailSendError({ code: 'VALIDATION', message })
}

function asMode(v: string): CommunicationMode {
  return (COMMUNICATION_MODES as string[]).includes(v) ? (v as CommunicationMode) : 'DISABLED'
}

type Row = Awaited<ReturnType<typeof prisma.communicationRule.findFirstOrThrow>>

function toRule(r: Row): CommunicationRule {
  return { tipo: r.tipo, mode: asMode(r.mode), requiredFields: r.requiredFields, autoSince: r.autoSince?.toISOString() ?? null }
}

/**
 * Reglas vigentes: los valores de fábrica, pisados por lo que el administrador haya guardado.
 * Así desplegar antes de crear la tabla (o guardar solo la regla de «Experimento») no apaga Novedad ni Pre-novedad.
 */
export async function loadRules(): Promise<CommunicationRule[]> {
  let rows: Row[] = []
  try {
    rows = await prisma.communicationRule.findMany()
  } catch (e) {
    // Tabla aún sin crear (db push pendiente): se opera con los valores de fábrica.
    console.error('[rules] no se pudo leer CommunicationRule; se usan las reglas de fábrica:', e instanceof Error ? e.message : e)
  }
  const byKey = new Map(DEFAULT_RULES.map((r) => [tipoKey(r.tipo), r]))
  for (const row of rows) byKey.set(tipoKey(row.tipo), toRule(row))
  return [...byKey.values()]
}

/** Tipos que existen en la Bitácora (opciones del campo «Tipo»), más los que ya tienen regla. */
export async function listKnownTipos(rules?: CommunicationRule[]): Promise<string[]> {
  const field = await prisma.field.findFirst({ where: { name: 'Tipo' }, include: { options: { orderBy: { order: 'asc' } } } })
  const seen = new Map<string, string>()
  for (const o of field?.options ?? []) seen.set(tipoKey(o.name), o.name)
  for (const r of rules ?? (await loadRules())) if (!seen.has(tipoKey(r.tipo))) seen.set(tipoKey(r.tipo), r.tipo)
  return [...seen.values()]
}

export interface RuleRowDTO extends CommunicationRule {
  /** custom = guardada en el panel | default = de fábrica | unset = sin configurar (deshabilitado). */
  source: 'custom' | 'default' | 'unset'
  updatedAt: string | null
  updatedByEmail: string | null
}

/** Una fila por tipo conocido, lista para mostrar en el panel. */
export async function getRulesState(): Promise<RuleRowDTO[]> {
  const [rules, rows] = await Promise.all([loadRules(), prisma.communicationRule.findMany().catch(() => [] as Row[])])
  const tipos = await listKnownTipos(rules)
  const saved = new Map(rows.map((r) => [tipoKey(r.tipo), r]))
  const defaults = new Set(DEFAULT_RULES.map((r) => tipoKey(r.tipo)))
  return tipos.map((tipo) => {
    const k = tipoKey(tipo)
    const rule = rules.find((r) => tipoKey(r.tipo) === k)
    const row = saved.get(k)
    if (!rule) return { tipo, mode: 'DISABLED' as const, requiredFields: DEFAULT_REQUIRED_FIELDS, autoSince: null, source: 'unset' as const, updatedAt: null, updatedByEmail: null }
    return {
      ...rule,
      tipo,
      source: row ? ('custom' as const) : defaults.has(k) ? ('default' as const) : ('unset' as const),
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedByEmail: row?.updatedByEmail ?? null,
    }
  })
}

export interface RuleInput {
  tipo: unknown
  mode: unknown
  requiredFields: unknown
}

/** Valida y guarda la regla de un tipo. El cambio aplica de ahí en adelante y queda en el audit log. */
export async function saveRule(actor: SettingsActor, input: RuleInput): Promise<RuleRowDTO[]> {
  if (typeof input.tipo !== 'string' || !input.tipo.trim()) bad('Elige el tipo de novedad.')
  const known = (await listKnownTipos()).find((t) => tipoKey(t) === tipoKey(input.tipo))
  if (!known) bad(`El tipo «${String(input.tipo).slice(0, 60)}» no existe en la Bitácora.`)

  if (typeof input.mode !== 'string' || !(COMMUNICATION_MODES as string[]).includes(input.mode)) bad(`Modo inválido. Opciones: ${COMMUNICATION_MODES.join(', ')}.`)
  const mode = input.mode as CommunicationMode

  if (!Array.isArray(input.requiredFields)) bad('Los campos obligatorios deben ser una lista.')
  const invalid = input.requiredFields.filter((k) => !isRequirableField(k))
  if (invalid.length) bad(`Campos no válidos como obligatorios: ${invalid.map(String).join(', ')}.`)
  const requiredFields = [...new Set(input.requiredFields as string[])]
  if (mode !== 'DISABLED' && requiredFields.length === 0) bad('Un tipo habilitado necesita al menos un campo obligatorio.')

  const rules = await loadRules()
  const prev = rules.find((r) => tipoKey(r.tipo) === tipoKey(known)) ?? null
  const prevMode = prev?.mode ?? 'DISABLED'
  const prevFields = prev?.requiredFields ?? DEFAULT_REQUIRED_FIELDS
  const sameFields = prevFields.length === requiredFields.length && prevFields.every((k, i) => k === requiredFields[i])
  if (prev && prevMode === mode && sameFields) bad('No hay cambios para guardar.')

  // Sin retroactivos: al pasar a AUTO solo salen solas las novedades creadas desde ahora.
  const autoSince = mode === 'AUTO' ? (prevMode === 'AUTO' && prev?.autoSince ? new Date(prev.autoSince) : new Date()) : null

  const existing = (await prisma.communicationRule.findMany()).find((r) => tipoKey(r.tipo) === tipoKey(known))
  const data = { tipo: known, mode, requiredFields, autoSince, updatedByEmail: actor.email }
  if (existing) await prisma.communicationRule.update({ where: { id: existing.id }, data })
  else await prisma.communicationRule.create({ data })

  await addAuditLog({
    userId: actor.id,
    userEmail: actor.email,
    userName: actor.name ?? actor.email,
    action: 'COMMUNICATION_RULE_UPDATED',
    details: { tipo: known, from: { mode: prevMode, requiredFields: prevFields }, to: { mode, requiredFields } },
  })
  return getRulesState()
}
