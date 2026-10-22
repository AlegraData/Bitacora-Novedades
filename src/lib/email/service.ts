import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma'
import { addAuditLog } from '@/lib/actions/audit'
import { postRecordToWebhook } from './legacy-webhook'
import { loadFieldMap, mapRecordData } from '@/lib/mcp/fields'
import type { ButtonConfig, Role } from '@/types'
import { EmailSendError, type EmailError, type EmailErrorCode } from './errors'
import { getSettings, type DeliveryMode } from './settings'
import { getActiveTemplate } from './template-store'
import { renderEmail, TemplateError, type RenderedEmail } from './render'
import { buildVariables, type EmailVariables } from './variables'
import { getSmtpConfig, sendMail, smtpStatus, MAX_RECIPIENTS } from './transport'
import { sendChatCard } from './chat'
import { evaluateCommunication, COMMUNICATION_SINCE, BASE_REQUIRED_FIELDS } from './communication'

// TMDIAPD-56: se comunican TODOS los tipos de novedad. El envío automático solo aplica a registros
// creados desde el despliegue (ver COMMUNICATION_SINCE): no se dispara nada retroactivo.
export const AUTO_NOTIFY_SINCE = COMMUNICATION_SINCE

/** Campos obligatorios para comunicar (más «¿Trae video?» y, si es Sí, «Video»: ver evaluateCommunication). */
export const REQUIRED_NOTIFY_FIELDS = BASE_REQUIRED_FIELDS

export const STALE_SENDING_MS = 5 * 60_000

export type Channel = 'web' | 'mcp' | 'api' | 'admin'
export type Trigger = 'auto' | 'manual' | 'button'

export interface SendActor {
  id: string | null
  email: string
  name: string | null
  role: Role
}

export interface SendOptions {
  recordId: string
  actor: SendActor
  channel: Channel
  trigger: Trigger
  /** Renderiza y valida, pero no envía nada ni toma el lock. */
  simulate?: boolean
  /** Reenviar algo ya comunicado: solo ADMIN, con motivo. */
  resend?: { reason: string }
}

export interface SendResult {
  ok: boolean
  status: 'sent' | 'simulated' | 'failed' | 'skipped'
  mode?: DeliveryMode | 'simulate'
  deliveryId?: string
  subject?: string
  recipients?: string[]
  rejected?: string[]
  warnings?: string[]
  skippedReason?: string
  /** Con skippedReason "campos_incompletos": qué falta para poder comunicar. */
  missingFields?: string[]
  /** Solo en simulacros: el correo exacto que se enviaría. */
  html?: string
  text?: string
  error?: EmailError
  chat?: 'sent' | 'failed' | 'skipped'
}

type Logical = Record<string, unknown>

function failure(code: EmailErrorCode, message: string, extra: Partial<EmailError> = {}): SendResult {
  return { ok: false, status: 'failed', error: { code, message, ...extra } }
}

function skipped(reason: string, extra: Partial<SendResult> = {}): SendResult {
  return { ok: true, status: 'skipped', skippedReason: reason, ...extra }
}

function auditBase(actor: SendActor) {
  return { userId: actor.id, userEmail: actor.email, userName: actor.name ?? actor.email }
}

export async function findWebhookButton(): Promise<{ config: ButtonConfig; fieldMap: Map<string, string> } | null> {
  const button = await prisma.field.findFirst({ where: { type: 'button' } })
  const config = button?.config as ButtonConfig | null
  if (!config || config.action !== 'webhook' || !config.webhookUrl) return null
  const all = await prisma.field.findMany({ orderBy: { order: 'asc' } })
  return { config, fieldMap: new Map(all.map((f) => [f.id, f.name])) }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'
}

interface Ctx {
  opts: SendOptions
  started: number
  raw: { id: string; data: unknown; createdAt: Date }
  logical: Logical
  recipients: string[]
  invalid: string[]
  vars: EmailVariables
  rendered: RenderedEmail
  warnings: string[]
}

async function createDelivery(ctx: Ctx, data: { mode: string; status: string; lockKey: string | null; subject?: string; recipients: string[]; html?: string; resendReason?: string }) {
  const { opts } = ctx
  return prisma.emailDelivery.create({
    data: {
      recordId: opts.recordId,
      mode: data.mode,
      status: data.status,
      lockKey: data.lockKey,
      subject: data.subject ?? ctx.rendered.subject,
      recipients: data.recipients,
      html: data.html ?? ctx.rendered.html,
      channel: opts.channel,
      trigger: opts.simulate ? 'simulate' : opts.trigger,
      triggeredByEmail: opts.actor.email,
      triggeredByName: opts.actor.name,
      resendReason: data.resendReason,
    },
  })
}

async function finish(ctx: Ctx, id: string, patch: Prisma.EmailDeliveryUpdateInput) {
  await prisma.emailDelivery.update({ where: { id }, data: { ...patch, finishedAt: new Date(), durationMs: Date.now() - ctx.started } })
}

/**
 * Orquesta un envío: valida → renderiza → (simula | toma el lock → envía por el modo activo) → registra → audita.
 * Nunca lanza por errores de negocio: siempre devuelve un SendResult con el motivo.
 */
export async function sendNovedad(opts: SendOptions): Promise<SendResult> {
  const started = Date.now()
  const auto = opts.trigger === 'auto'

  const raw = await prisma.record.findUnique({ where: { id: opts.recordId } })
  if (!raw) return auto ? skipped('not_found') : failure('NOT_FOUND', `Registro "${opts.recordId}" no encontrado.`)

  const map = await loadFieldMap()
  const rawData = raw.data as Record<string, unknown>
  const logical = mapRecordData(rawData, map)

  if (auto && raw.createdAt < AUTO_NOTIFY_SINCE) return skipped('registro_anterior_al_cutover')

  if (opts.resend) {
    if (opts.actor.role !== 'ADMIN') return failure('FORBIDDEN', 'Solo un ADMIN puede reenviar una novedad ya comunicada.')
    if (!opts.resend.reason?.trim()) return failure('VALIDATION', 'Para reenviar indica el motivo.')
  }

  // Validación: obligatorios para todos los tipos + «¿Trae video?» (y Video si es Sí).
  const missingFields = evaluateCommunication(logical, { traeVideoConfigured: map.has('traeVideo') }).missing
  // Destinatarios: SOLO los configurados en el admin (TMDIAPD-56). «Correos a comunicar» es informativo.
  const settings = await getSettings()
  const notify = settings.recipients
  const recipients = notify.map((r) => r.email)
  const invalid: string[] = []
  if (missingFields.length > 0) {
    // En auto es un estado normal y transitorio (aún no se llenan todos los campos).
    return auto
      ? skipped('campos_incompletos', { missingFields })
      : failure('VALIDATION', 'No se puede comunicar todavía: faltan datos obligatorios.', { missingFields, invalidRecipients: invalid.length ? invalid : undefined })
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return failure('VALIDATION', `Hay ${recipients.length} destinatarios; el máximo es ${MAX_RECIPIENTS}.`)
  }

  const template = await getActiveTemplate()
  const vars = buildVariables(logical, opts.recordId)
  let rendered: RenderedEmail
  try {
    rendered = renderEmail(template, vars)
  } catch (e) {
    if (e instanceof TemplateError) return failure('TEMPLATE', e.message)
    throw e
  }

  const warnings = invalid.length ? [`Se omitieron direcciones con formato inválido: ${invalid.join(', ')}`] : []
  const ctx: Ctx = { opts, started, raw, logical, recipients, invalid, vars, rendered, warnings }

  // ---- Simulacro: el correo exacto, sin enviar ni bloquear nada ----
  if (opts.simulate) {
    const d = await createDelivery(ctx, { mode: 'simulate', status: 'simulated', lockKey: null, recipients })
    await finish(ctx, d.id, {})
    await addAuditLog({ ...auditBase(opts.actor), action: 'EMAIL_SIMULATED', recordId: opts.recordId, details: { deliveryId: d.id, channel: opts.channel, recipients: recipients.length } })
    return { ok: true, status: 'simulated', mode: 'simulate', deliveryId: d.id, subject: rendered.subject, recipients, warnings, html: rendered.html, text: rendered.text }
  }

  switch (settings.mode) {
    case 'test':
      return runTest(ctx, settings.testRecipients, settings.fromName, settings.replyTo)
    case 'live':
      return runReal(ctx, 'live', settings.fromName, settings.replyTo)
    case 'shadow':
    case 'webhook':
      return runReal(ctx, settings.mode, settings.fromName, settings.replyTo)
  }
}

// ---------- modo test: SMTP real, pero solo a los correos de prueba ----------

async function runTest(ctx: Ctx, testRecipients: string[], fromName: string, replyTo: string | null): Promise<SendResult> {
  const { opts } = ctx
  if (!getSmtpConfig()) return failure('SMTP_NOT_CONFIGURED', 'El servidor de correo no está configurado todavía.', { detail: `Faltan variables: ${smtpStatus().missing.join(', ')}` })
  if (testRecipients.length === 0) return failure('MODE_CONFIG', 'El modo "test" no tiene correos de prueba configurados.')

  // En auto solo se manda una prueba por registro (si no, cada guardado mandaría otra).
  const lockKey = opts.trigger === 'auto' ? `test:${opts.recordId}` : null
  let delivery
  try {
    delivery = await createDelivery(ctx, { mode: 'test', status: 'sending', lockKey, subject: `[TEST] ${ctx.rendered.subject}`, recipients: testRecipients })
  } catch (e) {
    if (isUniqueViolation(e)) return skipped('prueba_ya_enviada')
    throw e
  }

  try {
    const sent = await sendMail({ to: testRecipients, subject: `[TEST] ${ctx.rendered.subject}`, html: ctx.rendered.html, text: ctx.rendered.text, fromName, replyTo })
    await finish(ctx, delivery.id, { status: 'sent', messageId: sent.messageId, rejected: sent.rejected, recipients: sent.accepted })
    await addAuditLog({ ...auditBase(opts.actor), action: 'EMAIL_TEST_SENT', recordId: opts.recordId, details: { deliveryId: delivery.id, channel: opts.channel, to: sent.accepted.length } })
    return { ok: true, status: 'sent', mode: 'test', deliveryId: delivery.id, subject: `[TEST] ${ctx.rendered.subject}`, recipients: sent.accepted, rejected: sent.rejected, warnings: ctx.warnings }
  } catch (e) {
    return recordFailure(ctx, delivery.id, 'test', e)
  }
}

// ---------- modos real (live) y legado (webhook / shadow): con lock atómico ----------

/**
 * ¿Ya se comunicó esta novedad con la versión anterior de la app? Tres rastros posibles:
 * - NOTIFIED_PMKT: el envío automático / notify_pmkt.
 * - WEBHOOK_TRIGGERED: el botón "Enviar email" (nunca escribía NOTIFIED_PMKT).
 * - La fecha en el campo del botón: es lo que la pantalla muestra como "✅ Sí".
 */
export async function findLegacySend(ctx: Pick<Ctx, 'raw' | 'opts'>): Promise<{ deliveryId: string; sentAt: string | null; by: string } | null> {
  const audit = await prisma.auditLog.findFirst({
    where: { recordId: ctx.opts.recordId, action: { in: ['NOTIFIED_PMKT', 'WEBHOOK_TRIGGERED'] } },
    orderBy: { timestamp: 'asc' },
  })
  if (audit) return { deliveryId: `legacy:${audit.id}`, sentAt: audit.timestamp.toISOString(), by: audit.userEmail }

  const buttons = await prisma.field.findMany({ where: { type: 'button' }, select: { id: true } })
  const data = ctx.raw.data as Record<string, unknown>
  for (const b of buttons) {
    const v = data[b.id]
    if (typeof v === 'string' && v.trim()) {
      const at = new Date(v)
      return { deliveryId: 'legacy:button', sentAt: Number.isNaN(at.getTime()) ? null : at.toISOString(), by: 'el botón «Enviar email»' }
    }
  }
  return null
}

async function acquireLock(ctx: Ctx, mode: string): Promise<{ delivery: { id: string } } | SendResult> {
  const { opts } = ctx
  const lockKey = `novedad:${opts.recordId}`
  const data = { mode, status: 'sending', lockKey, recipients: ctx.recipients, resendReason: opts.resend?.reason }

  const attempt = async () => {
    // Registros comunicados con la versión anterior (sin fila en EmailDelivery): se reconocen por su rastro.
    const holder = await prisma.emailDelivery.findUnique({ where: { lockKey } })
    if (!holder && !opts.resend) {
      const legacy = await findLegacySend(ctx)
      if (legacy) return { duplicate: legacy }
    }
    try {
      return { delivery: await createDelivery(ctx, data) }
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
      const current = await prisma.emailDelivery.findUnique({ where: { lockKey } })
      return { held: current }
    }
  }

  let res = await attempt()
  for (let i = 0; i < 2 && 'held' in res; i++) {
    const h = res.held
    if (!h) { res = await attempt(); continue } // se liberó entre medio
    const age = Date.now() - h.createdAt.getTime()
    if (h.status === 'sending' && age > STALE_SENDING_MS) {
      // Un envío que quedó "enviando" (la instancia murió a medias): se marca fallido y se libera.
      await prisma.emailDelivery.update({ where: { id: h.id }, data: { status: 'failed', lockKey: null, errorCode: 'TIMEOUT', errorMessage: 'El envío quedó sin terminar (se recuperó automáticamente).', finishedAt: new Date() } })
      res = await attempt()
    } else if (h.status === 'sending') {
      return failure('IN_PROGRESS', 'Ya hay un envío de esta novedad en curso. Espera unos segundos.')
    } else if (opts.resend) {
      // Reenvío autorizado: el envío anterior queda en el historial pero suelta el lock.
      await prisma.emailDelivery.update({ where: { id: h.id }, data: { lockKey: null } })
      res = await attempt()
    } else {
      res = { duplicate: { deliveryId: h.id, sentAt: (h.finishedAt ?? h.createdAt).toISOString(), by: h.triggeredByEmail } }
    }
  }

  if ('duplicate' in res) {
    return opts.trigger === 'auto'
      ? skipped('ya_enviado')
      : failure('DUPLICATE', 'Esta novedad ya se comunicó antes. Solo un ADMIN puede reenviarla.', { previous: res.duplicate })
  }
  if ('held' in res) return failure('IN_PROGRESS', 'Ya hay un envío de esta novedad en curso. Espera unos segundos.')
  return { delivery: res.delivery }
}

async function runReal(ctx: Ctx, mode: 'live' | 'webhook' | 'shadow', fromName: string, replyTo: string | null): Promise<SendResult> {
  const { opts } = ctx

  // Se comprueba lo que el modo necesita ANTES de tomar el lock, para no dejar nada colgado.
  let webhook: Awaited<ReturnType<typeof findWebhookButton>> = null
  if (mode === 'live') {
    if (!getSmtpConfig()) return failure('SMTP_NOT_CONFIGURED', 'El servidor de correo no está configurado todavía.', { detail: `Faltan variables: ${smtpStatus().missing.join(', ')}` })
  } else {
    webhook = await findWebhookButton()
    if (!webhook) return failure('MODE_CONFIG', 'No hay un campo tipo botón con la URL del Apps Script configurada (modo "webhook"/"shadow").')
  }

  const locked = await acquireLock(ctx, mode)
  if (!('delivery' in locked)) return locked
  const { delivery } = locked

  if (opts.resend) {
    await addAuditLog({ ...auditBase(opts.actor), action: 'EMAIL_RESEND', recordId: opts.recordId, details: { deliveryId: delivery.id, reason: opts.resend.reason, channel: opts.channel } })
  }

  try {
    let sentTo = ctx.recipients
    let rejected: string[] = []
    let messageId: string | undefined
    let legacyResponse: string | undefined
    let chat: SendResult['chat']

    if (mode === 'live') {
      const sent = await sendMail({ to: ctx.recipients, subject: ctx.rendered.subject, html: ctx.rendered.html, text: ctx.rendered.text, fromName, replyTo })
      sentTo = sent.accepted
      rejected = sent.rejected
      messageId = sent.messageId
      // La tarjeta de Chat la publica la app solo en vivo; en webhook/shadow la sigue publicando el Apps Script.
      const c = await sendChatCard({ elaborado: ctx.vars.elaborado, titulo: ctx.vars.titulo, tipo: ctx.vars.tipo, url: ctx.vars.url })
      chat = c.status
      await prisma.emailDelivery.update({ where: { id: delivery.id }, data: { chatStatus: c.status, chatError: c.status === 'failed' ? c.error : null } })
    } else {
      try {
        const res = await postRecordToWebhook({
          webhookUrl: webhook!.config.webhookUrl,
          recordId: opts.recordId,
          recordData: ctx.raw.data as Record<string, unknown>,
          fieldMap: webhook!.fieldMap,
          config: webhook!.config,
          triggeredBy: opts.actor.email,
        })
        legacyResponse = `${res.status} ${res.body}`.trim()
      } catch (e) {
        throw new EmailSendError({ code: 'WEBHOOK', message: 'El Apps Script no aceptó el envío.', detail: e instanceof Error ? e.message.slice(0, 300) : String(e) })
      }
    }

    await finish(ctx, delivery.id, { status: 'sent', messageId, rejected, recipients: sentTo, legacyResponse })
    await addAuditLog({ ...auditBase(opts.actor), action: 'EMAIL_SENT', recordId: opts.recordId, details: { deliveryId: delivery.id, mode, channel: opts.channel, to: sentTo.length } })

    // Sombra: el Apps Script ya envió de verdad; la app deja constancia de lo que HABRÍA enviado, para comparar.
    if (mode === 'shadow') {
      const sim = await createDelivery(ctx, { mode: 'shadow', status: 'simulated', lockKey: null, recipients: ctx.recipients })
      await finish(ctx, sim.id, {})
    }
    return { ok: true, status: 'sent', mode, deliveryId: delivery.id, subject: ctx.rendered.subject, recipients: sentTo, rejected, warnings: ctx.warnings, chat }
  } catch (e) {
    return recordFailure(ctx, delivery.id, mode, e)
  }
}

/** Marca el envío como fallido, libera el lock (para poder reintentar) y devuelve el motivo. */
async function recordFailure(ctx: Ctx, deliveryId: string, mode: string, e: unknown): Promise<SendResult> {
  const info: EmailError = e instanceof EmailSendError ? e.info : { code: 'UNKNOWN', message: 'No se pudo enviar el correo por un error inesperado.', detail: e instanceof Error ? e.message.slice(0, 300) : undefined }
  if (!(e instanceof EmailSendError)) console.error('[email] error inesperado al enviar:', e)
  await finish(ctx, deliveryId, { status: 'failed', lockKey: null, errorCode: info.code, errorMessage: info.message, errorDetail: info.detail, rejected: info.rejectedRecipients })
  await addAuditLog({ ...auditBase(ctx.opts.actor), action: 'EMAIL_FAILED', recordId: ctx.opts.recordId, details: { deliveryId, mode, code: info.code, channel: ctx.opts.channel } })
  return { ok: false, status: 'failed', mode: mode as DeliveryMode, deliveryId, subject: ctx.rendered.subject, recipients: ctx.recipients, error: info, warnings: ctx.warnings }
}
