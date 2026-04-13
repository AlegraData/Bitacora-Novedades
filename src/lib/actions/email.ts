'use server'

import { prisma } from '@/lib/prisma'
import type { Field, BitacoraRecord } from '@/types'
import { addAuditLog } from './audit'
import { getCurrentUserProfile } from './users'
import { saveRecord } from './records'

function fillTemplate(
  template: string,
  record: BitacoraRecord,
  fields: Field[]
): string {
  let result = template
  for (const field of fields) {
    const value = String(record.data[field.id] ?? '')
    const escaped = field.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`\\{\\{${escaped}\\}\\}`, 'gi'), value)
    result = result.replace(new RegExp(`\\{\\{${field.id}\\}\\}`, 'gi'), value)
  }
  return result
}

function buildHtmlEmail(subject: string, body: string, record: BitacoraRecord, fields: Field[]): string {
  const rows = fields
    .filter((f) => f.isVisible && f.type !== 'button')
    .map((f) => {
      const val = record.data[f.id]
      if (val === undefined || val === null || val === '') return ''
      return `<tr>
        <td style="padding:6px 12px;color:#718096;font-size:13px;width:140px;vertical-align:top;">${f.name}</td>
        <td style="padding:6px 12px;color:#2d3748;font-size:13px;">${String(val).replace(/\n/g, '<br>')}</td>
      </tr>`
    })
    .join('')

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f7fa;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#1e2a3a;padding:20px 28px;">
  <p style="margin:0;color:#00C4A0;font-size:11px;font-family:Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;">Alegra · Bitácora</p>
  <h2 style="margin:4px 0 0;color:#ffffff;font-family:Arial,sans-serif;font-size:18px;">Bitácora Novedades Product</h2>
</td></tr>
<tr><td style="padding:24px 28px 8px;border-bottom:1px solid #e2e8f0;">
  <h3 style="margin:0;color:#1a202c;font-family:Arial,sans-serif;font-size:20px;">${subject}</h3>
</td></tr>
${body ? `<tr><td style="padding:16px 28px;color:#4a5568;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;">${body.replace(/\n/g, '<br>')}</td></tr>` : ''}
${rows ? `<tr><td style="padding:8px 28px 24px;">
  <p style="margin:0 0 8px;color:#a0aec0;font-size:11px;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;">Detalles del registro</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">${rows}</table>
</td></tr>` : ''}
<tr><td style="background:#f7fafc;padding:16px 28px;border-top:1px solid #e2e8f0;">
  <p style="margin:0;color:#a0aec0;font-size:12px;font-family:Arial,sans-serif;">Enviado automáticamente desde Bitácora Novedades Product · Alegra</p>
</td></tr>
</table></td></tr></table></body></html>`
}

export async function triggerButtonEmail(
  recordId: string,
  buttonFieldId: string
): Promise<{ emails: string[]; subject: string }> {
  const user = await getCurrentUserProfile()
  if (!user) throw new Error('No autenticado')

  const [rawRecord, rawField] = await Promise.all([
    prisma.record.findUnique({ where: { id: recordId } }),
    prisma.field.findUnique({ where: { id: buttonFieldId } }),
  ])

  if (!rawRecord) throw new Error('Registro no encontrado')
  if (!rawField || rawField.type !== 'button') throw new Error('Campo botón no encontrado')

  const config = rawField.config as {
    action: string
    targetFieldId: string
    emailSubject: string
    emailBody: string
    logFieldId?: string
  } | null

  if (!config || config.action !== 'send_email') {
    throw new Error('El botón no tiene configurada la acción "send_email".')
  }

  const allFields = await prisma.field.findMany({
    include: { options: true, permissions: true },
    orderBy: { order: 'asc' },
  })

  const fields = allFields.map((f) => ({
    ...f,
    type: f.type as Field['type'],
    config: f.config as Field['config'],
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    options: f.options,
    permissions: f.permissions,
  }))

  const record: BitacoraRecord = {
    id: rawRecord.id,
    data: rawRecord.data as BitacoraRecord['data'],
    createdAt: rawRecord.createdAt.toISOString(),
    updatedAt: rawRecord.updatedAt.toISOString(),
    createdByEmail: rawRecord.createdByEmail,
    createdByName: rawRecord.createdByName,
  }

  const emailValue = String(record.data[config.targetFieldId] ?? '')
  if (!emailValue) throw new Error('El campo destino está vacío.')

  const emails = emailValue
    .split(/[,;\n]/)
    .map((e) => e.trim())
    .filter((e) => e.includes('@'))

  if (emails.length === 0) throw new Error('No se encontraron correos válidos.')

  const subject = fillTemplate(config.emailSubject ?? 'Notificación', record, fields)
  const body = fillTemplate(config.emailBody ?? '', record, fields)
  const html = buildHtmlEmail(subject, body, record, fields)

  // Send via Resend
  const RESEND_API_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.RESEND_FROM_EMAIL ?? 'Bitácora <noreply@alegra.com>'

  if (RESEND_API_KEY) {
    const { Resend } = await import('resend')
    const resend = new Resend(RESEND_API_KEY)
    await resend.emails.send({ from: FROM, to: emails, subject, html })
  } else {
    console.warn('[Email] RESEND_API_KEY not set — skipping send.')
  }

  // Log send if logFieldId configured
  if (config.logFieldId) {
    const now = new Date().toLocaleString('es-CO')
    const existing = String(record.data[config.logFieldId] ?? '')
    const logEntry = `${now} → ${emails.join(', ')}`
    await saveRecord({
      id: recordId,
      recordData: {
        ...record.data,
        [config.logFieldId]: existing ? `${existing}\n${logEntry}` : logEntry,
      },
    })
  }

  await addAuditLog({
    userId: user.id,
    userEmail: user.email,
    userName: user.name ?? user.email,
    action: 'EMAIL_SENT',
    recordId,
    details: { buttonFieldId, emails },
  })

  return { emails, subject }
}
