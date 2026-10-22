import type { Role } from '@/types'
import type { SendResult } from './service'
import type { EmailError } from './errors'

/**
 * Lo que sale hacia pantalla, MCP y API. El detalle técnico del SMTP (respuestas del servidor,
 * códigos) solo lo ve un ADMIN; el correo renderizado solo se devuelve si se pide.
 */
export function toClientResult(r: SendResult, role: Role, include: { html?: boolean; text?: boolean } = {}): SendResult {
  const out: SendResult = { ...r }
  if (!include.html) delete out.html
  if (!include.text) delete out.text
  if (role !== 'ADMIN' && out.error) out.error = { ...out.error, detail: undefined }
  return out
}

/** Texto de una línea para mostrar en alertas/toasts. */
export function describeError(e: EmailError): string {
  const parts = [e.message]
  if (e.missingFields?.length) parts.push(`Falta: ${e.missingFields.join(', ')}.`)
  if (e.invalidRecipients?.length) parts.push(`Direcciones inválidas: ${e.invalidRecipients.join(', ')}.`)
  if (e.rejectedRecipients?.length) parts.push(`Rechazadas por el servidor: ${e.rejectedRecipients.join(', ')}.`)
  if (e.previous) parts.push(`Enviado antes por ${e.previous.by}${e.previous.sentAt ? ` el ${new Date(e.previous.sentAt).toLocaleString('es-CO')}` : ''}.`)
  if (e.detail) parts.push(`Detalle: ${e.detail}`)
  return parts.join(' ')
}
