import { prisma } from '@/lib/prisma'
import { loadFieldMap, mapRecordData } from '@/lib/mcp/fields'
import { evaluateCommunication, findRule, COMMUNICATION_SINCE, type CommunicationMode } from './communication'
import { loadRules } from './rules'
import { sendNovedad, type SendResult } from './service'
import { sendFromButton } from './button'
import type { SettingsActor } from './settings'

// Lo que necesita el panel de administrador (TMDIAPD-65) además de las reglas: novedades pendientes y reejecución.

export interface PendingRow {
  id: string
  titulo: string
  tipo: string
  createdAt: string
  mode: CommunicationMode
  /** incomplete = faltan campos | ready = completa y aún sin comunicar (a la espera de envío manual o de reintento). */
  state: 'incomplete' | 'ready'
  missing: string[]
}

/**
 * Novedades aún sin comunicar, de los tipos habilitados, con el campo que les falta.
 * Mira las más recientes posteriores al corte de la comunicación automática (no recorre todo el histórico).
 * «Comunicada» = hay un envío real, un rastro de la versión anterior o la fecha en el campo del botón.
 */
export async function listPending(opts: { tipo?: string; limit?: number } = {}): Promise<PendingRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300)
  const [rules, map, rows, buttons] = await Promise.all([
    loadRules(),
    loadFieldMap(),
    prisma.record.findMany({ where: { createdAt: { gte: COMMUNICATION_SINCE } }, orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.field.findMany({ where: { type: 'button' }, select: { id: true } }),
  ])
  const ids = rows.map((r) => r.id)
  const [sent, audits] = await Promise.all([
    prisma.emailDelivery.findMany({ where: { recordId: { in: ids }, status: 'sent', mode: { in: ['live', 'webhook', 'shadow', 'legacy'] } }, select: { recordId: true } }),
    prisma.auditLog.findMany({ where: { recordId: { in: ids }, action: { in: ['NOTIFIED_PMKT', 'WEBHOOK_TRIGGERED'] } }, select: { recordId: true } }),
  ])
  const done = new Set([...sent.map((d) => d.recordId), ...audits.map((a) => a.recordId)])

  const out: PendingRow[] = []
  for (const r of rows) {
    const data = r.data as Record<string, unknown>
    if (done.has(r.id) || buttons.some((b) => typeof data[b.id] === 'string' && String(data[b.id]).trim())) continue
    const logical = mapRecordData(data, map)
    const rule = findRule(rules, logical.tipo)
    if (!rule || rule.mode === 'DISABLED') continue
    const tipo = String(Array.isArray(logical.tipo) ? logical.tipo[0] : logical.tipo ?? '')
    if (opts.tipo && opts.tipo !== tipo) continue
    const { missing } = evaluateCommunication(logical, { traeVideoConfigured: map.has('traeVideo'), requiredFields: rule.requiredFields })
    out.push({
      id: r.id,
      titulo: String(logical.titulo ?? '').trim().slice(0, 140) || '(sin título)',
      tipo,
      createdAt: r.createdAt.toISOString(),
      mode: rule.mode,
      state: missing.length ? 'incomplete' : 'ready',
      missing,
    })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Vuelve a ejecutar el envío de una novedad (fallida o ya enviada) con motivo obligatorio.
 * Pasa por el mismo servicio que el botón: mismas reglas, mismo historial y marca el botón si sale.
 */
export async function resendFromPanel(actor: SettingsActor, recordId: unknown, reason: unknown): Promise<SendResult> {
  if (typeof recordId !== 'string' || !recordId.trim()) return { ok: false, status: 'failed', error: { code: 'NOT_FOUND', message: 'Registro no encontrado.' } }
  const sendActor = { id: actor.id, email: actor.email, name: actor.name, role: 'ADMIN' as const }
  const resend = { reason: typeof reason === 'string' ? reason : '' }
  const button = await prisma.field.findFirst({ where: { type: 'button' }, select: { id: true } })
  if (button) return sendFromButton(sendActor, recordId, button.id, { resend })
  return sendNovedad({ recordId, actor: sendActor, channel: 'admin', trigger: 'manual', resend })
}
