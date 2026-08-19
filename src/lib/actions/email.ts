'use server'

import { prisma } from '@/lib/prisma'
import type { Field, BitacoraRecord } from '@/types'
import { buildHtmlEmail } from '@/lib/email-template'
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
