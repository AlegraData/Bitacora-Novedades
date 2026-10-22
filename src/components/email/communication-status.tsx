'use client'

import { evaluateCommunication, logicalFromFields, hasTraeVideoField, COMMUNICATION_SINCE } from '@/lib/email/communication'

type FieldLite = { id: string; name: string }

/** Qué falta para comunicar una novedad (null si no aplica mostrar nada: ya enviada o registro anterior al corte). */
export function pendingFor(data: Record<string, unknown>, fields: FieldLite[], createdAt: string, done: boolean): string[] | null {
  if (done || new Date(createdAt) < COMMUNICATION_SINCE) return null
  const check = evaluateCommunication(logicalFromFields(data, fields), { traeVideoConfigured: hasTraeVideoField(fields) })
  return check.ready ? [] : check.missing
}

/** Etiqueta compacta para la tabla: «⏳ Falta: video». Vacía si no hay nada pendiente. */
export function PendingChip({ missing }: { missing: string[] | null }) {
  if (!missing || missing.length === 0) return null
  const short = missing[0].replace(/\s*\(.*\)\s*$/, '')
  return (
    <span
      title={`Pendiente de comunicar. Falta: ${missing.join(', ')}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', whiteSpace: 'nowrap' }}
    >
      ⏳ Falta: {short}{missing.length > 1 ? ` +${missing.length - 1}` : ''}
    </span>
  )
}

/** Estado de comunicación en el detalle de la novedad (se actualiza mientras se edita el formulario). */
export function CommunicationStatus({ data, fields, createdAt, done }: { data: Record<string, unknown>; fields: FieldLite[]; createdAt: string; done: boolean }) {
  let tone = { bg: '#f8fafc', border: '#e2e8f0', color: '#475569' }
  let text: React.ReactNode

  if (done) {
    tone = { bg: '#f0fdf4', border: '#86efac', color: '#166534' }
    text = <>✅ <b>Comunicada.</b> Para volver a enviarla hace falta un ADMIN.</>
  } else if (new Date(createdAt) < COMMUNICATION_SINCE) {
    text = <>Registro anterior al envío automático: no se comunica sola. Puedes enviarla manualmente.</>
  } else {
    const missing = evaluateCommunication(logicalFromFields(data, fields), { traeVideoConfigured: hasTraeVideoField(fields) }).missing
    if (missing.length === 0) {
      tone = { bg: '#eff6ff', border: '#93c5fd', color: '#1e3a8a' }
      text = <>🟢 <b>Lista para comunicar.</b> Se enviará sola al guardar (o pulsa Ejecutar).</>
    } else {
      tone = { bg: '#fffbeb', border: '#fcd34d', color: '#92400e' }
      text = (
        <>
          ⏳ <b>Pendiente de comunicar.</b> Falta: {missing.join(', ')}. Al completarlo y guardar, el correo sale solo.
        </>
      )
    }
  }
  return (
    <div role="status" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.5, background: tone.bg, border: `1px solid ${tone.border}`, color: tone.color }}>
      {text}
    </div>
  )
}
