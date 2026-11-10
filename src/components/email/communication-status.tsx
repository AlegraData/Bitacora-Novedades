'use client'

import { evaluateCommunication, logicalFromFields, hasTraeVideoField, findRule, shouldAutoSend, DEFAULT_RULES, TIPO_NO_COMUNICABLE, type CommunicationRule } from '@/lib/email/communication'

type FieldLite = { id: string; name: string }

/**
 * Qué falta para comunicar una novedad (null si no aplica mostrar nada: ya enviada, tipo deshabilitado o,
 * en modo automático, registro anterior al corte). `rules` son las reglas por tipo que configura el admin.
 */
export function pendingFor(data: Record<string, unknown>, fields: FieldLite[], createdAt: string, done: boolean, rules: CommunicationRule[] = DEFAULT_RULES): string[] | null {
  if (done) return null
  const logical = logicalFromFields(data, fields)
  const rule = findRule(rules, logical.tipo)
  if (!rule || rule.mode === 'DISABLED') return null // este tipo no se comunica: no hay nada «pendiente»
  if (rule.mode === 'AUTO' && !shouldAutoSend(rule, createdAt)) return null // registro anterior al envío automático
  const check = evaluateCommunication(logical, { traeVideoConfigured: hasTraeVideoField(fields), requiredFields: rule.requiredFields })
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
export function CommunicationStatus({ data, fields, createdAt, done, rules = DEFAULT_RULES }: { data: Record<string, unknown>; fields: FieldLite[]; createdAt: string; done: boolean; rules?: CommunicationRule[] }) {
  let tone = { bg: '#f8fafc', border: '#e2e8f0', color: '#475569' }
  let text: React.ReactNode

  const logical = logicalFromFields(data, fields)
  const rule = findRule(rules, logical.tipo)
  const missing = rule ? evaluateCommunication(logical, { traeVideoConfigured: hasTraeVideoField(fields), requiredFields: rule.requiredFields }).missing : []

  if (done) {
    tone = { bg: '#f0fdf4', border: '#86efac', color: '#166534' }
    text = <>✅ <b>Comunicada.</b> Si hace falta volver a enviarla, se pide el motivo y queda registrado.</>
  } else if (!rule || rule.mode === 'DISABLED') {
    text = <>{TIPO_NO_COMUNICABLE}</>
  } else if (rule.mode === 'MANUAL') {
    if (missing.length === 0) {
      tone = { bg: '#eff6ff', border: '#93c5fd', color: '#1e3a8a' }
      text = <>🟢 <b>Lista para comunicar.</b> Este tipo se envía solo de forma manual: pulsa Ejecutar cuando quieras comunicarla.</>
    } else {
      tone = { bg: '#fffbeb', border: '#fcd34d', color: '#92400e' }
      text = <>⏳ <b>Pendiente de comunicar.</b> Falta: {missing.join(', ')}. Este tipo se envía solo de forma manual (botón Ejecutar).</>
    }
  } else if (!shouldAutoSend(rule, createdAt)) {
    text = <>Registro anterior al envío automático: no se comunica sola. Puedes enviarla manualmente.</>
  } else if (missing.length === 0) {
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
  return (
    <div role="status" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.5, background: tone.bg, border: `1px solid ${tone.border}`, color: tone.color }}>
      {text}
    </div>
  )
}
