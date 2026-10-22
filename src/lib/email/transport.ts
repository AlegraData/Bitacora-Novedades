import nodemailer from 'nodemailer'
import { EmailSendError, type EmailError, type EmailErrorCode } from './errors'

export const MAX_RECIPIENTS = 50

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass?: string
  fromEmail: string
}

function isLocalHost(host: string) {
  return host === 'localhost' || host === '127.0.0.1'
}

/** null si falta algo: contra un servidor real se exige usuario y contraseña (solo el SMTP local de pruebas va sin clave). */
export function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim()
  const user = process.env.SMTP_USER?.trim()
  // Google muestra la contraseña de aplicación en bloques de 4 separados por espacios: se ignoran.
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, '')
  if (!host || !user) return null
  if (!isLocalHost(host) && !pass) return null
  const port = Number(process.env.SMTP_PORT) || 587
  return {
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    user,
    pass: pass || undefined,
    fromEmail: process.env.SMTP_FROM_EMAIL?.trim() || user,
  }
}

/** Estado para mostrar en el admin. Nunca incluye la contraseña. */
export function smtpStatus() {
  const host = process.env.SMTP_HOST?.trim() || null
  const user = process.env.SMTP_USER?.trim() || null
  return {
    configured: getSmtpConfig() !== null,
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    user,
    fromEmail: process.env.SMTP_FROM_EMAIL?.trim() || user,
    hasPassword: Boolean(process.env.SMTP_PASS),
    missing: [!host && 'SMTP_HOST', !user && 'SMTP_USER', host && !isLocalHost(host) && !process.env.SMTP_PASS && 'SMTP_PASS'].filter(Boolean) as string[],
  }
}

// ---------- destinatarios ----------

const EMAIL_RE = /^[^\s@,;<>"'()[\]\\]+@[^\s@,;<>"'()[\]\\]+\.[^\s@,;<>"'()[\]\\]+$/

export function isValidEmail(s: string): boolean {
  return s.length <= 254 && EMAIL_RE.test(s)
}

/**
 * Acepta un arreglo o texto separado por coma, punto y coma o salto de línea. Normaliza a
 * minúsculas y quita duplicados. NO separa por espacios: "Bcc: x@y.com" debe quedar inválido,
 * no convertirse en un destinatario más.
 */
export function parseRecipients(input: unknown): { valid: string[]; invalid: string[] } {
  const raw = (Array.isArray(input) ? input : [input]).flatMap((v) => (typeof v === 'string' ? v.split(/[,;\r\n]+/) : []))
  const valid: string[] = []
  const invalid: string[] = []
  for (const item of raw.map((s) => s.trim()).filter(Boolean)) {
    const lower = item.toLowerCase()
    if (isValidEmail(lower)) {
      if (!valid.includes(lower)) valid.push(lower)
    } else if (!invalid.includes(item)) {
      invalid.push(item.slice(0, 120))
    }
  }
  return { valid, invalid }
}

// ---------- errores ----------

const BASE64_BLOB = /[A-Za-z0-9+/=]{24,}/g

function redact(text: string): string {
  let out = text.replace(BASE64_BLOB, '[redactado]')
  const pass = process.env.SMTP_PASS
  if (pass && pass.length >= 4) out = out.split(pass).join('[redactado]')
  return out.replace(/\s+/g, ' ').trim().slice(0, 500)
}

interface NodemailerLikeError {
  code?: string
  responseCode?: number
  response?: string
  command?: string
  rejected?: string[]
  message?: string
}

export function mapSmtpError(err: unknown): EmailError {
  const e = (err ?? {}) as NodemailerLikeError
  const text = `${e.response ?? ''} ${e.message ?? ''}`
  const rejected = Array.isArray(e.rejected) ? e.rejected.map(String) : undefined
  const detail = redact([e.code, e.responseCode, e.command, e.response || e.message].filter(Boolean).join(' | '))
  const done = (code: EmailErrorCode, message: string): EmailError => ({ code, message, detail, ...(rejected?.length ? { rejectedRecipients: rejected } : {}) })

  // Gmail responde "550 5.4.5 Daily user sending limit exceeded": va antes que el 550 genérico de destinatario.
  if (/daily (user )?sending (limit|quota)|sending limit exceeded|quota exceeded|rate limit|too many (messages|connections|recipients)/i.test(text) || [421, 450, 452, 454].includes(e.responseCode ?? 0)) {
    return done('RATE_LIMIT', 'La cuenta de correo alcanzó su límite de envío (diario o por minuto). Intenta más tarde.')
  }
  if (e.code === 'EAUTH' || [530, 534, 535].includes(e.responseCode ?? 0)) {
    return done('SMTP_AUTH', 'No se pudo autenticar con el servidor de correo. Revisa el usuario y la contraseña de aplicación.')
  }
  if (e.code === 'EENVELOPE' || [550, 551, 553].includes(e.responseCode ?? 0)) {
    return done('RECIPIENT_REJECTED', 'El servidor rechazó a uno o más destinatarios (dirección inexistente o no permitida).')
  }
  if (e.code === 'ETIMEDOUT' || e.code === 'ESOCKETTIMEDOUT' || e.code === 'ECONNRESET' || /timed? ?out/i.test(text)) {
    return done('TIMEOUT', 'El servidor de correo tardó demasiado en responder. Reintenta en un momento.')
  }
  if (['ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ENOTFOUND', 'EDNS', 'EHOSTUNREACH', 'ENETUNREACH'].includes(e.code ?? '')) {
    return done('CONNECTION', 'No se pudo conectar con el servidor de correo (revisa host y puerto).')
  }
  if (e.code === 'EMESSAGE' || e.responseCode === 554 || (e.responseCode && e.responseCode >= 500)) {
    return done('MESSAGE_REJECTED', 'El servidor de correo rechazó el mensaje.')
  }
  return done('UNKNOWN', 'No se pudo enviar el correo por un error inesperado.')
}

// ---------- envío ----------

export interface MailInput {
  to: string[]
  subject: string
  html: string
  text?: string
  fromName: string
  replyTo?: string | null
}

export interface MailResult {
  messageId: string
  accepted: string[]
  rejected: string[]
  response: string
}

interface TransportLike {
  sendMail(opts: Record<string, unknown>): Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[]; response?: string }>
  verify(): Promise<unknown>
}

type TransportFactory = (cfg: SmtpConfig) => TransportLike

const defaultFactory: TransportFactory = (cfg) =>
  nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    // Contra Gmail (587) se exige STARTTLS; el SMTP local de pruebas va sin cifrado.
    requireTLS: !cfg.secure && !isLocalHost(cfg.host),
    tls: { minVersion: 'TLSv1.2' },
    auth: cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })

let factory: TransportFactory = defaultFactory

/** Solo para tests: reemplaza el transporte (null = el real). */
export function setTransportFactory(f: TransportFactory | null) {
  factory = f ?? defaultFactory
}

function notConfigured(): EmailSendError {
  const missing = smtpStatus().missing
  return new EmailSendError({
    code: 'SMTP_NOT_CONFIGURED',
    message: 'El servidor de correo no está configurado todavía.',
    detail: missing.length ? `Faltan variables: ${missing.join(', ')}` : undefined,
  })
}

// eslint-disable-next-line no-control-regex
const HEADER_UNSAFE = /[\u0000-\u001F\u007F<>"]/g

export async function sendMail(input: MailInput): Promise<MailResult> {
  const cfg = getSmtpConfig()
  if (!cfg) throw notConfigured()

  const to = parseRecipients(input.to).valid
  if (to.length === 0) throw new EmailSendError({ code: 'VALIDATION', message: 'No hay destinatarios válidos.' })
  if (to.length > MAX_RECIPIENTS) {
    throw new EmailSendError({ code: 'VALIDATION', message: `Demasiados destinatarios (${to.length}); el máximo es ${MAX_RECIPIENTS}.` })
  }
  const replyTo = input.replyTo ? parseRecipients(input.replyTo).valid[0] : undefined

  const transporter = factory(cfg)
  try {
    const info = await transporter.sendMail({
      from: { name: input.fromName.replace(HEADER_UNSAFE, '').trim() || 'Alegra', address: cfg.fromEmail },
      to,
      subject: input.subject.replace(HEADER_UNSAFE, ' ').replace(/\s{2,}/g, ' ').trim(),
      html: input.html,
      text: input.text,
      ...(replyTo ? { replyTo } : {}),
    })
    const accepted = (info.accepted ?? []).map(String)
    const rejected = (info.rejected ?? []).map(String)
    if (accepted.length === 0) {
      throw Object.assign(new Error('Ningún destinatario fue aceptado'), { code: 'EENVELOPE', rejected })
    }
    return { messageId: String(info.messageId ?? ''), accepted, rejected, response: redact(String(info.response ?? '')) }
  } catch (err) {
    throw new EmailSendError(mapSmtpError(err))
  }
}

export async function verifySmtp(): Promise<{ ok: true } | { ok: false; error: EmailError }> {
  const cfg = getSmtpConfig()
  if (!cfg) return { ok: false, error: notConfigured().info }
  try {
    await factory(cfg).verify()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mapSmtpError(err) }
  }
}
