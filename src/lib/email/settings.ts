import { prisma } from '@/lib/prisma'
import { addAuditLog } from '@/lib/actions/audit'
import { smtpStatus, parseRecipients } from './transport'
import { EmailSendError } from './errors'
import type { Prisma } from '@/generated/prisma'
import { normalizeRecipients, recipientsOrDefault, RecipientsError, type NotifyRecipient } from './recipients'

export type DeliveryMode = 'webhook' | 'shadow' | 'test' | 'live'
export const DELIVERY_MODES: DeliveryMode[] = ['webhook', 'shadow', 'test', 'live']

export const MODE_LABELS: Record<DeliveryMode, string> = {
  webhook: 'Apps Script (legado)',
  shadow: 'Sombra: Apps Script envía y la app simula',
  test: 'Prueba: SMTP solo a los correos de prueba',
  live: 'En vivo: SMTP a los destinatarios reales',
}

export const MAX_TEST_RECIPIENTS = 5

/** Los correos de prueba solo pueden ir a estos dominios: evita usar la app como relay abierto. */
export function allowedTestDomains(): string[] {
  return (process.env.EMAIL_TEST_DOMAINS || 'alegra.com').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
}

export function isAllowedTestAddress(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  return !!domain && allowedTestDomains().includes(domain)
}

export interface EmailSettingsDTO {
  mode: DeliveryMode
  fromName: string
  replyTo: string | null
  testRecipients: string[]
  /** Destinatarios de la notificación (los de por defecto mientras nadie los cambie). */
  recipients: NotifyRecipient[]
  recipientsCustomized: boolean
  updatedAt: string | null
  updatedByEmail: string | null
}

export async function getSettings(): Promise<EmailSettingsDTO> {
  const s = await prisma.emailSettings.upsert({ where: { id: 'singleton' }, update: {}, create: {} })
  return {
    mode: (DELIVERY_MODES as string[]).includes(s.mode) ? (s.mode as DeliveryMode) : 'webhook',
    fromName: s.fromName,
    replyTo: s.replyTo,
    testRecipients: s.testRecipients,
    recipients: recipientsOrDefault(s.notifyRecipients),
    recipientsCustomized: s.notifyRecipients != null,
    updatedAt: s.updatedAt.toISOString(),
    updatedByEmail: s.updatedByEmail,
  }
}

export interface SettingsPatch {
  mode?: unknown
  fromName?: unknown
  replyTo?: unknown
  testRecipients?: unknown
  recipients?: unknown
}

export interface SettingsActor {
  id: string
  email: string
  name: string | null
}

function bad(message: string): never {
  throw new EmailSendError({ code: 'VALIDATION', message })
}

/** Valida y guarda. Cambiar de modo exige que lo que ese modo necesita ya esté listo. */
export async function updateSettings(actor: SettingsActor, patch: SettingsPatch): Promise<EmailSettingsDTO> {
  const current = await getSettings()
  const data: { mode?: string; fromName?: string; replyTo?: string | null; testRecipients?: string[]; notifyRecipients?: NotifyRecipient[] } = {}

  if (patch.fromName !== undefined) {
    const v = typeof patch.fromName === 'string' ? patch.fromName.trim() : ''
    if (v.length < 1 || v.length > 60 || /[\r\n<>"]/.test(v)) bad('El nombre del remitente debe tener 1-60 caracteres, sin saltos de línea ni < > ".')
    data.fromName = v
  }

  if (patch.replyTo !== undefined) {
    if (patch.replyTo === null || patch.replyTo === '') data.replyTo = null
    else {
      const parsed = typeof patch.replyTo === 'string' ? parseRecipients(patch.replyTo) : { valid: [], invalid: ['?'] }
      if (parsed.valid.length !== 1 || parsed.invalid.length) bad('El correo de respuesta (reply-to) no es válido.')
      data.replyTo = parsed.valid[0]
    }
  }

  if (patch.testRecipients !== undefined) {
    const parsed = parseRecipients(patch.testRecipients)
    if (parsed.invalid.length) bad(`Correos de prueba inválidos: ${parsed.invalid.join(', ')}`)
    const outside = parsed.valid.filter((e) => !isAllowedTestAddress(e))
    if (outside.length) bad(`Solo se permiten correos de prueba @${allowedTestDomains().join(', @')}. No permitidos: ${outside.join(', ')}`)
    if (parsed.valid.length > MAX_TEST_RECIPIENTS) bad(`Máximo ${MAX_TEST_RECIPIENTS} correos de prueba.`)
    data.testRecipients = parsed.valid
  }

  if (patch.recipients !== undefined) {
    try {
      data.notifyRecipients = normalizeRecipients(patch.recipients)
    } catch (e) {
      if (e instanceof RecipientsError) bad(e.message)
      throw e
    }
  }

  if (patch.mode !== undefined) {
    if (!(DELIVERY_MODES as unknown[]).includes(patch.mode)) bad(`Modo inválido. Opciones: ${DELIVERY_MODES.join(', ')}.`)
    const mode = patch.mode as DeliveryMode
    const tests = data.testRecipients ?? current.testRecipients
    if ((mode === 'test' || mode === 'live') && !smtpStatus().configured) {
      throw new EmailSendError({
        code: 'SMTP_NOT_CONFIGURED',
        message: `No se puede pasar a modo "${mode}": el servidor de correo (SMTP) no está configurado.`,
        detail: smtpStatus().missing.length ? `Faltan variables: ${smtpStatus().missing.join(', ')}` : undefined,
      })
    }
    if (mode === 'test' && tests.length === 0) bad('Para el modo "test" configura al menos un correo de prueba.')
    data.mode = mode
  }

  if (Object.keys(data).length === 0) bad('No hay cambios para guardar.')

  const { notifyRecipients, ...rest } = data
  await prisma.emailSettings.update({
    where: { id: 'singleton' },
    data: { ...rest, ...(notifyRecipients ? { notifyRecipients: notifyRecipients as unknown as Prisma.InputJsonValue } : {}), updatedByEmail: actor.email },
  })
  await addAuditLog({
    userId: actor.id,
    userEmail: actor.email,
    userName: actor.name ?? actor.email,
    action: 'EMAIL_SETTINGS_UPDATED',
    details: { changed: Object.keys(data), ...(data.mode ? { from: current.mode, to: data.mode } : {}) },
  })
  return getSettings()
}
