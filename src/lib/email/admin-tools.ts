import { prisma } from '@/lib/prisma'
import { addAuditLog } from '@/lib/actions/audit'
import { loadFieldMap, mapRecordData } from '@/lib/mcp/fields'
import { EmailSendError, type EmailError } from './errors'
import { renderEmail, TemplateError, type RenderedEmail } from './render'
import { buildVariables, sampleVariables } from './variables'
import { getActiveTemplate } from './template-store'
import { getSettings, isAllowedTestAddress, allowedTestDomains, MAX_TEST_RECIPIENTS, type SettingsActor } from './settings'
import { getSmtpConfig, parseRecipients, sendMail, smtpStatus } from './transport'
import { sendNovedad, type SendResult } from './service'
import { RateLimiter } from '@/lib/api/rate-limit'

/** Límite de correos de prueba por admin: evita convertir la herramienta en un emisor masivo. */
export const testLimiter = new RateLimiter(10, 60 * 60_000)

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function fail(error: EmailError, extra: Partial<SendResult> = {}): SendResult {
  return { ok: false, status: 'failed', error, ...extra }
}

export interface TestEmailInput {
  addresses: unknown
  /** Novedad real para los datos; vacío = datos de ejemplo. */
  recordId?: unknown
  /** Borrador del editor (sin guardar); vacío = la plantilla guardada. */
  subject?: unknown
  html?: unknown
}

/** Envía un correo de prueba por SMTP SOLO a las direcciones indicadas (@alegra.com, máx. 5). Nunca toca a los destinatarios reales. */
export async function sendTestEmail(actor: SettingsActor, input: TestEmailInput): Promise<SendResult> {
  const rl = testLimiter.hit(actor.email)
  if (!rl.allowed) {
    return fail({ code: 'RATE_LIMIT', message: `Máximo ${rl.limit} correos de prueba por hora. Intenta de nuevo en ${Math.ceil(rl.retryAfterSec / 60)} min.` })
  }

  const { valid, invalid } = parseRecipients(input.addresses)
  if (invalid.length) return fail({ code: 'VALIDATION', message: `Direcciones inválidas: ${invalid.join(', ')}`, invalidRecipients: invalid })
  if (valid.length === 0) return fail({ code: 'VALIDATION', message: 'Indica al menos un correo de prueba.' })
  if (valid.length > MAX_TEST_RECIPIENTS) return fail({ code: 'VALIDATION', message: `Máximo ${MAX_TEST_RECIPIENTS} correos de prueba.` })
  const outside = valid.filter((e) => !isAllowedTestAddress(e))
  if (outside.length) {
    return fail({ code: 'VALIDATION', message: `Solo se permiten correos de prueba @${allowedTestDomains().join(', @')}. No permitidos: ${outside.join(', ')}` })
  }
  if (!getSmtpConfig()) {
    return fail({ code: 'SMTP_NOT_CONFIGURED', message: 'El servidor de correo no está configurado todavía.', detail: `Faltan variables: ${smtpStatus().missing.join(', ')}` })
  }

  let rendered: RenderedEmail
  let recordId: string | undefined
  try {
    let vars = sampleVariables()
    if (typeof input.recordId === 'string' && input.recordId) {
      if (!ID_RE.test(input.recordId)) return fail({ code: 'NOT_FOUND', message: 'Registro no encontrado.' })
      const rec = await prisma.record.findUnique({ where: { id: input.recordId } })
      if (!rec) return fail({ code: 'NOT_FOUND', message: 'Registro no encontrado.' })
      vars = buildVariables(mapRecordData(rec.data as Record<string, unknown>, await loadFieldMap()), rec.id)
      recordId = rec.id
    }
    const template =
      typeof input.subject === 'string' && typeof input.html === 'string'
        ? { subject: input.subject.trim(), html: input.html }
        : await getActiveTemplate()
    rendered = renderEmail(template, vars)
  } catch (e) {
    if (e instanceof TemplateError) return fail({ code: 'TEMPLATE', message: e.message })
    throw e
  }

  const settings = await getSettings()
  const subject = `[TEST] ${rendered.subject}`
  const started = Date.now()
  const delivery = await prisma.emailDelivery.create({
    data: {
      recordId, mode: 'test', status: 'sending', lockKey: null, subject, recipients: valid, html: rendered.html,
      channel: 'admin', trigger: 'test', triggeredByEmail: actor.email, triggeredByName: actor.name,
    },
  })

  try {
    const sent = await sendMail({ to: valid, subject, html: rendered.html, text: rendered.text, fromName: settings.fromName, replyTo: settings.replyTo })
    await prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: { status: 'sent', messageId: sent.messageId, recipients: sent.accepted, rejected: sent.rejected, finishedAt: new Date(), durationMs: Date.now() - started },
    })
    await addAuditLog({ userId: actor.id, userEmail: actor.email, userName: actor.name ?? actor.email, action: 'EMAIL_TEST_SENT', recordId, details: { deliveryId: delivery.id, channel: 'admin', to: sent.accepted.length } })
    return { ok: true, status: 'sent', mode: 'test', deliveryId: delivery.id, subject, recipients: sent.accepted, rejected: sent.rejected }
  } catch (e) {
    const info: EmailError = e instanceof EmailSendError ? e.info : { code: 'UNKNOWN', message: 'No se pudo enviar el correo de prueba.' }
    await prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: { status: 'failed', errorCode: info.code, errorMessage: info.message, errorDetail: info.detail, finishedAt: new Date(), durationMs: Date.now() - started },
    })
    await addAuditLog({ userId: actor.id, userEmail: actor.email, userName: actor.name ?? actor.email, action: 'EMAIL_FAILED', recordId, details: { deliveryId: delivery.id, mode: 'test', code: info.code, channel: 'admin' } })
    return fail(info, { mode: 'test', deliveryId: delivery.id, subject, recipients: valid })
  }
}

/** Simulacro sobre una novedad real: valida y renderiza el correo exacto sin enviar nada. */
export async function simulateRecord(actor: SettingsActor, recordId: unknown): Promise<SendResult> {
  if (typeof recordId !== 'string' || !ID_RE.test(recordId)) return fail({ code: 'NOT_FOUND', message: 'Registro no encontrado.' })
  return sendNovedad({
    recordId,
    actor: { id: actor.id, email: actor.email, name: actor.name, role: 'ADMIN' },
    channel: 'admin',
    trigger: 'manual',
    simulate: true,
  })
}

export interface ShadowRow {
  recordId: string
  subject: string | null
  legacy: { status: string; at: string; by: string; response: string | null; error: string | null; suspicious: boolean } | null
  simulated: { deliveryId: string; subject: string | null; recipients: string[]; at: string } | null
}

export interface ShadowComparison {
  total: number
  legacyOk: number
  legacyFailed: number
  suspicious: number
  rows: ShadowRow[]
}

/**
 * Modo sombra: por cada novedad, lo que hizo el Apps Script (envío real) frente a lo que la app habría
 * enviado. "Sospechoso" = el Apps Script respondió 200 pero su cuerpo no dice success (puede haber
 * fallado por dentro, ya que ese script devuelve 200 aun con errores).
 */
export async function shadowComparison(limit = 50): Promise<ShadowComparison> {
  const rows = await prisma.emailDelivery.findMany({ where: { mode: 'shadow' }, orderBy: { createdAt: 'desc' }, take: Math.min(limit, 200) * 2 })
  const byRecord = new Map<string, ShadowRow>()
  for (const r of rows) {
    const key = r.recordId ?? r.id
    const row = byRecord.get(key) ?? { recordId: key, subject: null, legacy: null, simulated: null }
    if (r.status === 'simulated') {
      row.simulated = { deliveryId: r.id, subject: r.subject, recipients: r.recipients, at: r.createdAt.toISOString() }
      row.subject = r.subject
    } else {
      const ok = r.status === 'sent'
      row.legacy = {
        status: r.status,
        at: (r.finishedAt ?? r.createdAt).toISOString(),
        by: r.triggeredByEmail,
        response: r.legacyResponse,
        error: r.errorMessage,
        suspicious: ok && !/success/i.test(r.legacyResponse ?? ''),
      }
    }
    byRecord.set(key, row)
  }
  const list = [...byRecord.values()].slice(0, limit)
  return {
    total: list.length,
    legacyOk: list.filter((r) => r.legacy?.status === 'sent' && !r.legacy.suspicious).length,
    legacyFailed: list.filter((r) => r.legacy?.status === 'failed').length,
    suspicious: list.filter((r) => r.legacy?.suspicious).length,
    rows: list,
  }
}

// ---------------- Chat: resolver IDs y mensaje de prueba ----------------

import { resolveChatUsers, itHubConfigured, type ResolvedUser } from './it-hub'
import { sendChatMentionTest } from './chat'
import { ensureChatIds, toMentions } from './chat-ids'
import { mentionable } from './recipients'

/** Para el botón «Resolver IDs de Chat»: consulta el IT Hub y devuelve lo encontrado (la pantalla decide qué guardar). */
export async function resolveIdsForAdmin(emails: unknown): Promise<ResolvedUser[]> {
  const { valid } = parseRecipients(emails)
  return resolveChatUsers(valid.slice(0, 20))
}

export interface ChatTestResult {
  ok: boolean
  /** A qué webhook se publicó: un espacio de pruebas o el canal real. */
  target: 'prueba' | 'produccion' | 'ninguno'
  mentioned: string[]
  unresolved: { email: string; error?: string }[]
  error?: string
}

/**
 * Publica un mensaje de prueba mencionando a los destinatarios de la notificación (completando los IDs que falten).
 * Si hay PMKT_CHAT_TEST_WEBHOOK_URL va a ese espacio de pruebas; si no, al canal real (¡notifica a esas personas!).
 */
export async function sendChatTest(actor: SettingsActor): Promise<ChatTestResult> {
  const rl = testLimiter.hit(`chat:${actor.email}`)
  if (!rl.allowed) {
    return { ok: false, target: 'ninguno', mentioned: [], unresolved: [], error: `Máximo ${rl.limit} mensajes de prueba por hora. Intenta en ${Math.ceil(rl.retryAfterSec / 60)} min.` }
  }
  const settings = await getSettings()
  const { recipients: resolved, unresolved } = await ensureChatIds(settings.recipients)
  const recipients = mentionable(resolved) // los marcados «no mencionar» (p. ej. un grupo) no se etiquetan
  const result = await sendChatMentionTest(toMentions(recipients))

  await addAuditLog({
    userId: actor.id, userEmail: actor.email, userName: actor.name ?? actor.email, action: 'EMAIL_CHAT_TEST',
    details: { target: result.target, status: result.status, mentioned: recipients.filter((r) => r.chatUserId).length, unresolved: unresolved.length },
  })
  return {
    ok: result.status === 'sent',
    target: result.target,
    mentioned: recipients.filter((r) => r.chatUserId).map((r) => r.name ?? r.email),
    unresolved: unresolved.map((u) => ({ email: u.email, error: u.error })),
    ...(result.status === 'failed' ? { error: result.error } : result.status === 'skipped' ? { error: 'No hay webhook de Chat configurado (PMKT_CHAT_WEBHOOK_URL).' } : {}),
  }
}

export { itHubConfigured }
