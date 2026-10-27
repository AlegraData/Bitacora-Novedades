import { isValidEmail } from './transport'

// Destinatarios de la notificación de novedades (TMDIAPD-56). Se configuran en Admin → Correos; el correo
// va SOLO a ellos (ya no a «Correos a comunicar» de cada registro). Se guardan con su ID de Chat para poder
// mencionarlos en la tarjeta de Google Chat.

export interface NotifyRecipient {
  email: string
  name?: string
  /** ID numérico del usuario de Google (el de la mención <users/ID> de Chat). */
  chatUserId?: string
  /**
   * false = no se menciona en la tarjeta de Chat (ni se consulta su ID). Es lo que corresponde a un grupo
   * como tm-alegra, que recibe el correo pero no se etiqueta. Ausente = se menciona si tiene ID.
   */
  mention?: boolean
}

export const MAX_NOTIFY_RECIPIENTS = 20

/**
 * Decisión final de PMKT: el correo va al grupo tm-alegra (lo reciben todos sus miembros) y no se menciona a nadie
 * en Chat. Se puede cambiar en Admin → Correos (lista de destinatarios y casilla «Mencionar en Chat»).
 */
export const DEFAULT_NOTIFY_RECIPIENTS: NotifyRecipient[] = [
  { email: 'tm-alegra@alegra.com', name: 'TM Alegra', mention: false },
]

/** Quienes se mencionan en la tarjeta de Chat (los marcados con mention:false se excluyen). */
export function mentionable(recipients: NotifyRecipient[]): NotifyRecipient[] {
  return recipients.filter((r) => r.mention !== false)
}

export const CHAT_USER_ID_RE = /^\d{10,25}$/

// eslint-disable-next-line no-control-regex
const NAME_UNSAFE = /[\u0000-\u001F\u007F<>*_~`"]/g

export class RecipientsError extends Error {}

/** Valida y normaliza una lista enviada desde la pantalla (o leída de la base). Lanza RecipientsError con el motivo. */
export function normalizeRecipients(input: unknown): NotifyRecipient[] {
  if (!Array.isArray(input) || input.length === 0) throw new RecipientsError('Agrega al menos un destinatario.')
  if (input.length > MAX_NOTIFY_RECIPIENTS) throw new RecipientsError(`Máximo ${MAX_NOTIFY_RECIPIENTS} destinatarios.`)

  const seen = new Set<string>()
  const out: NotifyRecipient[] = []
  for (const item of input) {
    const raw = (item ?? {}) as Record<string, unknown>
    const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : ''
    if (!isValidEmail(email)) throw new RecipientsError(`Correo inválido: "${String(raw.email ?? '').slice(0, 80)}".`)
    if (seen.has(email)) continue
    seen.add(email)

    const r: NotifyRecipient = { email }
    if (typeof raw.name === 'string') {
      const name = raw.name.replace(NAME_UNSAFE, '').replace(/\s+/g, ' ').trim().slice(0, 80)
      if (name) r.name = name
    }
    if (raw.mention === false) r.mention = false
    if (raw.chatUserId !== undefined && raw.chatUserId !== null && raw.chatUserId !== '') {
      const id = String(raw.chatUserId).trim()
      if (!CHAT_USER_ID_RE.test(id)) throw new RecipientsError(`El ID de Chat de ${email} debe ser un número de 10 a 25 dígitos.`)
      r.chatUserId = id
    }
    out.push(r)
  }
  return out
}

/** Lee lo guardado; si está vacío o dañado usa los de por defecto (nunca devuelve una lista vacía). */
export function recipientsOrDefault(stored: unknown): NotifyRecipient[] {
  try {
    return normalizeRecipients(stored)
  } catch {
    return DEFAULT_NOTIFY_RECIPIENTS
  }
}
