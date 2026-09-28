'use server'

import { prisma } from '@/lib/prisma'
import { getCurrentUserProfile } from './users'
import { saveRecord } from './records'
import { addAuditLog } from './audit'
import type { BitacoraRecord, ButtonConfig } from '@/types'

const EMPTY_VALUES = new Set(['n/a', 'na', 'no aplica', 'ninguno'])

// Construye el payload con nombres de campo como claves. Filtra: campos
// internos (__blocks__), IDs no seleccionados en el botón, valores vacíos y "N/A".
function buildNamedData(
  recordData: Record<string, unknown>,
  fieldMap: Map<string, string>,
  config: ButtonConfig
): Record<string, unknown> {
  const sendAll = config.sendAllFields !== false
  const allowedIds = sendAll ? null : new Set(config.selectedFieldIds ?? [])

  const namedData: Record<string, unknown> = {}
  for (const [fieldId, value] of Object.entries(recordData)) {
    if (fieldId.startsWith('__')) continue
    if (allowedIds && !allowedIds.has(fieldId)) continue
    if (value === null || value === undefined || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === 'string' && EMPTY_VALUES.has(value.toLowerCase().trim())) continue
    const fieldName = fieldMap.get(fieldId) ?? fieldId
    namedData[fieldName] = value
  }
  return namedData
}

// POST al endpoint (Apps Script) que arma y envía el correo/tarjeta de chat.
// Único punto de contacto con ese endpoint — lo usan tanto el botón "Enviar
// email" de la app web como notify_pmkt del MCP, para no duplicar la lógica
// del único mecanismo de envío que existe (no hay Resend ni otro proveedor).
export async function postRecordToWebhook(params: {
  webhookUrl: string
  recordId: string
  recordData: Record<string, unknown>
  fieldMap: Map<string, string>
  config: ButtonConfig
  triggeredBy: string
}): Promise<void> {
  const namedData = buildNamedData(params.recordData, params.fieldMap, params.config)

  const response = await fetch(params.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recordId: params.recordId,
      data: namedData,
      triggeredBy: params.triggeredBy,
      triggeredAt: new Date().toISOString(),
    }),
  })

  if (!response.ok) {
    throw new Error(`El endpoint respondió con error ${response.status}: ${response.statusText}`)
  }
}

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

  const config = rawField.config as ButtonConfig | null
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

  const allFields = await prisma.field.findMany({ orderBy: { order: 'asc' } })
  const fieldMap = new Map(allFields.map((f) => [f.id, f.name]))

  await postRecordToWebhook({
    webhookUrl: config.webhookUrl,
    recordId,
    recordData: record.data,
    fieldMap,
    config,
    triggeredBy: user.email,
  })

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
