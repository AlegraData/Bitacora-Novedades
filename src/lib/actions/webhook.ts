'use server'

import { prisma } from '@/lib/prisma'
import { getCurrentUserProfile } from './users'
import { saveRecord } from './records'
import { addAuditLog } from './audit'
import type { BitacoraRecord } from '@/types'

export async function triggerButtonWebhook(
  recordId: string,
  buttonFieldId: string
): Promise<{ success: boolean }> {
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
    webhookUrl: string
    logFieldId?: string
  } | null

  if (!config || config.action !== 'webhook') throw new Error('El botón no tiene acción "webhook".')
  if (!config.webhookUrl) throw new Error('No hay URL de endpoint configurada.')

  const record: BitacoraRecord = {
    id: rawRecord.id,
    data: rawRecord.data as BitacoraRecord['data'],
    createdAt: rawRecord.createdAt.toISOString(),
    updatedAt: rawRecord.updatedAt.toISOString(),
    createdByEmail: rawRecord.createdByEmail,
    createdByName: rawRecord.createdByName,
  }

  // Obtener todos los campos para mapear id → nombre
  const allFields = await prisma.field.findMany({ orderBy: { order: 'asc' } })
  const fieldMap = new Map(allFields.map((f) => [f.id, f.name]))

  // Construir payload con nombres de campo como claves, filtrando vacíos
  const namedData: Record<string, unknown> = {}
  for (const [fieldId, value] of Object.entries(record.data)) {
    if (value === null || value === undefined || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    const fieldName = fieldMap.get(fieldId) ?? fieldId
    namedData[fieldName] = value
  }

  // POST al endpoint con datos legibles
  const response = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recordId: record.id,
      data: namedData,
      triggeredBy: user.email,
      triggeredAt: new Date().toISOString(),
    }),
  })

  if (!response.ok) {
    throw new Error(`El endpoint respondió con error ${response.status}: ${response.statusText}`)
  }

  // Guardar timestamp de ejecución en el campo del botón
  const now = new Date().toISOString()
  const newData: BitacoraRecord['data'] = { ...record.data, [buttonFieldId]: now }

  // Log opcional
  if (config.logFieldId) {
    const existing = String(record.data[config.logFieldId] ?? '')
    const entry = `${new Date().toLocaleString('es-CO')} → ejecutado por ${user.email}`
    newData[config.logFieldId] = existing ? `${existing}\n${entry}` : entry
  }

  await saveRecord({ id: recordId, recordData: newData })

  await addAuditLog({
    userId: user.id,
    userEmail: user.email,
    userName: user.name ?? user.email,
    action: 'WEBHOOK_TRIGGERED',
    recordId,
    details: { buttonFieldId, webhookUrl: config.webhookUrl },
  })

  return { success: true }
}
