import { EmailSendError } from './errors'
import { TemplateError } from './render'
import { getSettings, updateSettings, MODE_LABELS, DELIVERY_MODES, MAX_TEST_RECIPIENTS, allowedTestDomains, type EmailSettingsDTO, type SettingsActor, type SettingsPatch, type DeliveryMode } from './settings'
import { smtpStatus, verifySmtp } from './transport'
import { findWebhookButton } from './service'
import { publicAppUrl } from './variables'

export type AdminResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; detail?: string }

/** Convierte los errores de negocio en un resultado que la pantalla puede mostrar tal cual. */
export async function run<T>(fn: () => Promise<T>): Promise<AdminResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    if (e instanceof EmailSendError) return { ok: false, error: e.info.message, code: e.info.code, detail: e.info.detail }
    if (e instanceof TemplateError) return { ok: false, error: e.message, code: 'TEMPLATE' }
    console.error('[email-admin] error inesperado:', e)
    return { ok: false, error: 'Error inesperado. Intenta de nuevo.', code: 'UNKNOWN' }
  }
}

export interface AdminState {
  settings: EmailSettingsDTO
  smtp: ReturnType<typeof smtpStatus>
  chat: { configured: boolean; host: string | null }
  webhook: { configured: boolean }
  modes: { id: DeliveryMode; label: string }[]
  limits: { maxTestRecipients: number; testDomains: string[] }
  appUrl: string
}

/** Todo lo que necesita la pantalla de configuración. Nunca incluye contraseñas ni URLs con llaves. */
export async function getAdminState(): Promise<AdminState> {
  const [settings, webhook] = await Promise.all([getSettings(), findWebhookButton()])
  let chatHost: string | null = null
  try {
    if (process.env.PMKT_CHAT_WEBHOOK_URL) chatHost = new URL(process.env.PMKT_CHAT_WEBHOOK_URL).hostname
  } catch {
    chatHost = 'URL inválida'
  }
  return {
    settings,
    smtp: smtpStatus(),
    chat: { configured: Boolean(process.env.PMKT_CHAT_WEBHOOK_URL?.trim()), host: chatHost },
    webhook: { configured: webhook !== null },
    modes: DELIVERY_MODES.map((id) => ({ id, label: MODE_LABELS[id] })),
    limits: { maxTestRecipients: MAX_TEST_RECIPIENTS, testDomains: allowedTestDomains() },
    appUrl: publicAppUrl(),
  }
}

export function saveSettings(actor: SettingsActor, patch: SettingsPatch) {
  return run(() => updateSettings(actor, patch))
}

export function verifyConnection() {
  return run(async () => {
    const r = await verifySmtp()
    return r.ok ? { ok: true as const } : { ok: false as const, code: r.error.code, message: r.error.message, detail: r.error.detail }
  })
}
