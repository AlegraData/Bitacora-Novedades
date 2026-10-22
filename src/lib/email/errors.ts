// Códigos de error del envío de correos. Los comparten pantalla, MCP y API.

export type EmailErrorCode =
  | 'NOT_FOUND'
  | 'TIPO_NO_APLICA'
  | 'VALIDATION'
  | 'DUPLICATE'
  | 'FORBIDDEN'
  | 'TEMPLATE'
  | 'MODE_CONFIG'
  | 'SMTP_NOT_CONFIGURED'
  | 'SMTP_AUTH'
  | 'RECIPIENT_REJECTED'
  | 'RATE_LIMIT'
  | 'CONNECTION'
  | 'TIMEOUT'
  | 'MESSAGE_REJECTED'
  | 'WEBHOOK'
  | 'IN_PROGRESS'
  | 'UNKNOWN'

export const ERROR_TITLES: Record<EmailErrorCode, string> = {
  NOT_FOUND: 'El registro no existe',
  TIPO_NO_APLICA: 'Este tipo no se comunica',
  VALIDATION: 'Faltan datos para enviar',
  DUPLICATE: 'Ya se envió antes',
  FORBIDDEN: 'Sin permiso',
  TEMPLATE: 'Error en la plantilla del correo',
  MODE_CONFIG: 'Configuración de envío incompleta',
  SMTP_NOT_CONFIGURED: 'El servidor de correo no está configurado',
  SMTP_AUTH: 'No se pudo autenticar con el servidor de correo',
  RECIPIENT_REJECTED: 'El servidor rechazó a los destinatarios',
  RATE_LIMIT: 'Se alcanzó el límite de envío de la cuenta',
  CONNECTION: 'No se pudo conectar con el servidor de correo',
  TIMEOUT: 'El servidor de correo tardó demasiado en responder',
  MESSAGE_REJECTED: 'El servidor rechazó el mensaje',
  WEBHOOK: 'Falló el envío por el Apps Script',
  IN_PROGRESS: 'Hay un envío en curso',
  UNKNOWN: 'Error inesperado al enviar',
}

/** Estado HTTP que usa la API para cada código. */
export const HTTP_STATUS: Record<EmailErrorCode, number> = {
  NOT_FOUND: 404,
  TIPO_NO_APLICA: 422,
  VALIDATION: 422,
  DUPLICATE: 409,
  IN_PROGRESS: 409,
  FORBIDDEN: 403,
  TEMPLATE: 500,
  MODE_CONFIG: 503,
  SMTP_NOT_CONFIGURED: 503,
  SMTP_AUTH: 502,
  RECIPIENT_REJECTED: 502,
  RATE_LIMIT: 429,
  CONNECTION: 502,
  TIMEOUT: 504,
  MESSAGE_REJECTED: 502,
  WEBHOOK: 502,
  UNKNOWN: 500,
}

export interface EmailError {
  code: EmailErrorCode
  /** Mensaje legible para cualquier usuario. */
  message: string
  /** Detalle técnico (respuesta SMTP, etc.); la UI/API solo lo muestran a ADMIN. */
  detail?: string
  missingFields?: string[]
  invalidRecipients?: string[]
  rejectedRecipients?: string[]
  previous?: { deliveryId: string; sentAt: string | null; by: string }
}

export class EmailSendError extends Error {
  constructor(public readonly info: EmailError) {
    super(info.message)
    this.name = 'EmailSendError'
  }
}
