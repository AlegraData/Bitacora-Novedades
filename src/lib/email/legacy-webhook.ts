import type { ButtonConfig } from '@/types'

// Cliente del Apps Script legado (modos "webhook" y "shadow"). Se elimina en el corte final,
// cuando el envío ya sea 100% SMTP desde la app.

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

/** POST al Apps Script que armaba y enviaba el correo. Devuelve su respuesta para dejarla en el historial. */
export async function postRecordToWebhook(params: {
  webhookUrl: string
  recordId: string
  recordData: Record<string, unknown>
  fieldMap: Map<string, string>
  config: ButtonConfig
  triggeredBy: string
}): Promise<{ status: number; body: string }> {
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
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    throw new Error(`El endpoint respondió con error ${response.status}: ${response.statusText}`)
  }
  // El Apps Script responde 200 {"status":"success"} aunque su pipeline haya fallado por dentro;
  // se devuelve el cuerpo para dejarlo en el historial y poder comparar.
  const body = (await response.text().catch(() => '')).slice(0, 500)
  return { status: response.status, body }
}
