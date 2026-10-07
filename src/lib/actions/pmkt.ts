'use server'

import { prisma } from '@/lib/prisma'
import { addAuditLog } from './audit'
import { postRecordToWebhook } from './webhook'
import { loadFieldMap, mapRecordData } from '@/lib/mcp/fields'
import type { ButtonConfig } from '@/types'

// TMDIAPD-16: toda novedad/pre-novedad dispara la comunicación a PMKT sola,
// sin que el PO tenga que marcar un flag manual. Reemplaza el flujo de
// TMDIAPD-45, que exigía "Necesita comunicación de Product Marketing" = SI.
const PMKT_TIPOS = new Set(['novedad', 'pre-novedad', 'pre novedad'])

// Fecha de corte: el auto-disparo solo aplica a registros creados desde este
// cambio en adelante. Los ~700 registros existentes (muchos ya marcados "No"
// manualmente bajo el proceso viejo) no se re-notifican retroactivamente.
const AUTO_NOTIFY_SINCE = new Date('2026-10-07T00:00:00.000Z')

const REQUIRED_NOTIFY_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'titulo', label: 'Título' },
  { key: 'breveDescripcion', label: 'Breve descripción' },
  { key: 'fechaLanzamiento', label: 'Fecha de lanzamiento' },
  { key: 'fechaProduccion', label: 'Fecha real de producción' },
  { key: 'responsables', label: 'Responsables' },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface NotifyTrigger {
  id: string | null
  email: string
  name: string | null
}

type NotifyResult = Record<string, unknown>

export async function notifyPmktForRecord(
  recordId: string,
  opts: { mode: 'auto' | 'manual'; confirm?: boolean; triggeredBy: NotifyTrigger }
): Promise<NotifyResult> {
  const raw = await prisma.record.findUnique({ where: { id: recordId } })
  if (!raw) return opts.mode === 'auto' ? { skipped: true, reason: 'not_found' } : { error: `Registro "${recordId}" no encontrado.` }

  const map = await loadFieldMap()
  const rawData = raw.data as Record<string, unknown>
  const logical = mapRecordData(rawData, map)

  const tipo = String(logical.tipo ?? '').toLowerCase().trim()
  if (!PMKT_TIPOS.has(tipo)) {
    return opts.mode === 'auto'
      ? { skipped: true, reason: 'tipo_no_aplica' }
      : { error: `Este tipo de novedad ("${logical.tipo ?? ''}") no se comunica a PMKT. Solo aplica a Novedad / Pre-novedad.` }
  }

  if (opts.mode === 'auto' && raw.createdAt < AUTO_NOTIFY_SINCE) {
    return { skipped: true, reason: 'registro_anterior_al_cutover' }
  }

  const already = await prisma.auditLog.findFirst({ where: { recordId, action: 'NOTIFIED_PMKT' } })
  if (already) {
    return opts.mode === 'auto'
      ? { skipped: true, reason: 'ya_notificado' }
      : { error: 'Este registro ya fue comunicado previamente.', notifiedAt: already.timestamp.toISOString() }
  }

  // Validar formato real de correo (no solo que contenga "@").
  const correosField = map.get('correosAComunicar')
  const recipientsRaw = correosField ? rawData[correosField.id] : undefined
  const recipients = (Array.isArray(recipientsRaw) ? recipientsRaw : [])
    .map(String)
    .filter((e) => EMAIL_RE.test(e))

  const missingFields = REQUIRED_NOTIFY_FIELDS
    .filter(({ key }) => {
      const v = logical[key]
      if (Array.isArray(v)) return v.length === 0
      return v === undefined || v === null || String(v).trim() === ''
    })
    .map(({ label }) => label)
  if (recipients.length === 0) missingFields.push('Correos a comunicar (mínimo un destinatario con formato de correo válido)')

  if (missingFields.length > 0) {
    // En modo auto esto es un estado normal y transitorio (aún no se han
    // llenado todos los campos) — se reintenta solo en el próximo guardado,
    // sin loguear nada ni molestar a nadie.
    return opts.mode === 'auto'
      ? { skipped: true, reason: 'campos_incompletos', missingFields }
      : { error: 'No se puede comunicar todavía: faltan campos obligatorios en el registro.', missingFields }
  }

  const titulo = String(logical.titulo ?? 'Nueva novedad')
  const subject = `📣 PMKT: ${titulo}`

  // En modo manual, segunda capa de seguridad: preview antes de confirmar.
  // En modo auto no hay humano en el loop — se envía directo.
  if (opts.mode === 'manual' && opts.confirm !== true) {
    return {
      preview: true,
      subject,
      recipients,
      camposIncluidos: logical,
      instrucciones: 'Revisa que el asunto, destinatarios y campos sean correctos. Para enviar de verdad, vuelve a llamar a notify_pmkt con el mismo recordId y confirm: true.',
    }
  }

  // El envío real reutiliza el webhook de Apps Script que ya usa el botón
  // "Enviar email" de la app web (probado en producción).
  let emailSent = false
  let emailError: string | undefined
  try {
    const buttonField = await prisma.field.findFirst({ where: { type: 'button' } })
    const webhookConfig = buttonField?.config as ButtonConfig | null
    if (!webhookConfig || webhookConfig.action !== 'webhook' || !webhookConfig.webhookUrl) {
      throw new Error('No se encontró un campo tipo botón con acción "webhook" configurado (el mismo que usa "Enviar email" en la app web).')
    }

    const allFields = await prisma.field.findMany({ orderBy: { order: 'asc' } })
    const fieldNameMap = new Map(allFields.map((f) => [f.id, f.name]))

    await postRecordToWebhook({
      webhookUrl: webhookConfig.webhookUrl,
      recordId,
      recordData: rawData,
      fieldMap: fieldNameMap,
      config: webhookConfig,
      triggeredBy: opts.triggeredBy.email,
    })
    emailSent = true
  } catch (e) {
    emailError = e instanceof Error ? e.message : String(e)
    console.error('[pmkt] Error enviando vía webhook de Apps Script:', e)
  }

  let chatSent = false
  const chatWebhookUrl = process.env.PMKT_CHAT_WEBHOOK_URL
  if (chatWebhookUrl) {
    const chatLines = [`📣 *${titulo}*`]
    if (logical.breveDescripcion) chatLines.push(String(logical.breveDescripcion))
    if (logical.urlBitacora) chatLines.push(String(logical.urlBitacora))

    try {
      const res = await fetch(chatWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chatLines.join('\n') }),
      })
      chatSent = res.ok
      if (!res.ok) {
        console.error('[pmkt] Error enviando a Google Chat:', res.status, await res.text().catch(() => ''))
      }
    } catch (e) {
      console.error('[pmkt] Error de red enviando a Google Chat:', e)
    }
  } else {
    console.warn('[pmkt] PMKT_CHAT_WEBHOOK_URL no configurado — se omite el envío a Chat.')
  }

  // Solo se confirma (y se registra el guard de idempotencia) si el correo
  // realmente salió — igual que en TMDIAPD-45: nunca marcar como notificado
  // un envío que no ocurrió de verdad.
  if (!emailSent) {
    if (opts.mode === 'auto') {
      await addAuditLog({
        userId: opts.triggeredBy.id,
        userEmail: opts.triggeredBy.email,
        userName: opts.triggeredBy.name ?? opts.triggeredBy.email,
        action: 'PMKT_NOTIFY_FAILED',
        recordId,
        details: { via: 'auto', error: emailError, chatSent },
      })
      return { skipped: true, reason: 'error_envio', error: emailError }
    }
    return { error: 'No se pudo enviar el correo de comunicación PMKT.', reason: emailError ?? 'Error desconocido', chatSent }
  }

  await addAuditLog({
    userId: opts.triggeredBy.id,
    userEmail: opts.triggeredBy.email,
    userName: opts.triggeredBy.name ?? opts.triggeredBy.email,
    action: 'NOTIFIED_PMKT',
    recordId,
    details: { via: opts.mode, emailSent, chatSent, recipients },
  })

  return { notified: true, emailSent, chatSent, recipients }
}
