'use client'

import { useEffect, useState } from 'react'
import type { SendResult } from '@/lib/email/service'
import type { DeliveryDTO } from '@/lib/email/history'
import { ERROR_TITLES, type EmailErrorCode } from '@/lib/email/errors'
import { getRecordEmailHistory } from '@/lib/actions/email'
import { MIN_RESEND_REASON, MAX_RESEND_REASON } from '@/lib/email/communication'

const RETRYABLE: EmailErrorCode[] = ['SMTP_AUTH', 'CONNECTION', 'TIMEOUT', 'RATE_LIMIT', 'WEBHOOK', 'UNKNOWN', 'IN_PROGRESS', 'MESSAGE_REJECTED', 'RECIPIENT_REJECTED']

const MODE_NAMES: Record<string, string> = {
  live: 'en vivo',
  test: 'modo prueba',
  webhook: 'Apps Script',
  shadow: 'Apps Script (sombra)',
  simulate: 'simulacro',
  legacy: 'histórico',
}

const box = { borderRadius: 10, padding: '12px 14px', fontSize: 13, lineHeight: 1.5 } as const
const smallBtn = { padding: '4px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 12, fontWeight: 600, cursor: 'pointer' } as const

function list(items: string[] | undefined) {
  return items && items.length ? items.join(', ') : '—'
}

/**
 * Aviso de «esta novedad ya se comunicó» + motivo obligatorio antes de reenviar.
 * El motivo queda en el historial de envíos y en la auditoría.
 */
export function ResendDialog({ title, sentAt, by, onConfirm, onCancel }: {
  title?: string
  sentAt?: string | null
  by?: string | null
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  const clean = reason.trim()
  const valid = clean.length >= MIN_RESEND_REASON && clean.length <= MAX_RESEND_REASON
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Reenviar novedad" style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 480, padding: 20, fontSize: 13, lineHeight: 1.5, color: '#334155' }}>
        <div style={{ padding: '10px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e' }}>
          ⚠ <b>Esta novedad ya se comunicó{sentAt ? ` el ${new Date(sentAt).toLocaleString('es-CO')}` : ''}{by ? ` (${by})` : ''}.</b>{' '}
          Si la reenvías, los destinatarios recibirán otro correo y otra tarjeta en el canal de Chat.
        </div>
        {title && <div style={{ marginTop: 10 }}><b>Novedad:</b> {title}</div>}
        <label style={{ display: 'block', marginTop: 12, fontWeight: 600 }}>
          ¿Por qué se va a volver a enviar?
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MAX_RESEND_REASON}
            rows={3}
            autoFocus
            placeholder="Ej.: el primer correo salió incompleto, se corrigió la fecha de lanzamiento…"
            style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
          />
        </label>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Mínimo {MIN_RESEND_REASON} caracteres. Queda registrado con tu nombre en el historial de envíos.</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onCancel} style={smallBtn}>Cancelar</button>
          <button
            onClick={() => valid && onConfirm(clean)}
            disabled={!valid}
            style={{ ...smallBtn, background: valid ? '#1e2a3a' : '#e2e8f0', color: valid ? '#fff' : '#94a3b8', border: 'none', cursor: valid ? 'pointer' : 'default' }}
          >
            ↺ Reenviar de todos modos
          </button>
        </div>
      </div>
    </div>
  )
}

/** Resultado de un envío: qué pasó, a quién, y si falló, por qué (con lo que hay que corregir). */
export function EmailResultBanner({
  result,
  onClose,
  onRetry,
  onPreview,
  onResend,
  isAdmin,
}: {
  result: SendResult
  onClose: () => void
  onRetry?: () => void
  onPreview?: () => void
  /** Reenviar algo ya comunicado (pide el motivo). */
  onResend?: () => void
  /** Solo para el detalle técnico de los errores. */
  isAdmin: boolean
}) {
  const [showDetail, setShowDetail] = useState(false)
  const err = result.error

  let tone = { bg: '#f0fdf4', border: '#86efac', color: '#166534' }
  let title = ''
  if (result.status === 'sent') {
    title =
      result.mode === 'test' ? '🧪 Prueba enviada (modo prueba: solo a los correos de prueba)'
      : result.mode === 'webhook' || result.mode === 'shadow' ? '✅ Enviado por el Apps Script'
      : '✅ Correo enviado'
  } else if (result.status === 'simulated') {
    tone = { bg: '#eff6ff', border: '#93c5fd', color: '#1e3a8a' }
    title = '👁 Simulacro: no se envió nada'
  } else if (result.status === 'failed') {
    tone = { bg: '#fef2f2', border: '#fca5a5', color: '#991b1b' }
    title = `❌ ${err ? ERROR_TITLES[err.code] : 'No se pudo enviar'}`
  } else {
    tone = { bg: '#f8fafc', border: '#cbd5e1', color: '#475569' }
    title = '⏭ No se envió'
  }

  return (
    <div role="status" style={{ ...box, background: tone.bg, border: `1px solid ${tone.border}`, color: tone.color }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>{title}</strong>
        <button onClick={onClose} aria-label="Cerrar" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'inherit' }}>×</button>
      </div>

      {result.subject && <div style={{ marginTop: 4 }}><b>Asunto:</b> {result.subject}</div>}
      {result.recipients && result.recipients.length > 0 && result.status !== 'failed' && (
        <div><b>Para:</b> {list(result.recipients)}</div>
      )}
      {result.rejected && result.rejected.length > 0 && (
        <div style={{ color: '#9a3412' }}><b>El servidor rechazó a:</b> {list(result.rejected)}</div>
      )}
      {result.warnings?.map((w) => <div key={w} style={{ color: '#9a3412' }}>⚠ {w}</div>)}
      {result.chat && result.status === 'sent' && (
        <div>Chat: {result.chat === 'sent' ? 'avisado en el canal ✅' : result.chat === 'failed' ? 'no se pudo avisar (el correo sí salió) ⚠' : 'sin canal configurado'}</div>
      )}

      {err && (
        <div style={{ marginTop: 6 }}>
          <div>{err.code === 'DUPLICATE' ? 'Esta novedad ya se comunicó antes. Si hace falta, puedes reenviarla indicando el motivo.' : err.message}</div>
          {err.missingFields && err.missingFields.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <b>Completa estos campos:</b>
              <ul style={{ margin: '2px 0 0 18px', padding: 0 }}>{err.missingFields.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
          {err.invalidRecipients && err.invalidRecipients.length > 0 && <div><b>Direcciones inválidas:</b> {list(err.invalidRecipients)}</div>}
          {err.rejectedRecipients && err.rejectedRecipients.length > 0 && <div><b>Rechazadas por el servidor:</b> {list(err.rejectedRecipients)}</div>}
          {err.previous && (
            <div>
              <b>Ya enviado</b> por {err.previous.by}
              {err.previous.sentAt ? ` el ${new Date(err.previous.sentAt).toLocaleString('es-CO')}` : ''}.
            </div>
          )}
          {isAdmin && err.detail && (
            <div style={{ marginTop: 4 }}>
              <button onClick={() => setShowDetail((v) => !v)} style={{ ...smallBtn, fontSize: 11 }}>{showDetail ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}</button>
              {showDetail && <pre style={{ margin: '6px 0 0', padding: 8, background: '#fff', borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#334155' }}>{err.detail}</pre>}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {result.status === 'simulated' && onPreview && <button onClick={onPreview} style={smallBtn}>Ver el correo</button>}
        {result.status === 'failed' && err && RETRYABLE.includes(err.code) && onRetry && <button onClick={onRetry} style={smallBtn}>↻ Reintentar</button>}
        {result.status === 'failed' && err?.code === 'DUPLICATE' && onResend && <button onClick={onResend} style={{ ...smallBtn, background: '#1e2a3a', color: '#fff', border: 'none' }}>↺ Reenviar indicando el motivo</button>}
      </div>
    </div>
  )
}

/** Vista previa del correo exacto en un iframe aislado (sandbox sin scripts ni navegación). */
export function EmailPreviewModal({ result, onClose }: { result: SendResult; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Vista previa del correo" style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 760, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 13, color: '#334155' }}>
            <div><b>Asunto:</b> {result.subject}</div>
            <div><b>Para:</b> {list(result.recipients)}</div>
            {result.warnings?.map((w) => <div key={w} style={{ color: '#9a3412' }}>⚠ {w}</div>)}
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <iframe
          title="Vista previa del correo"
          sandbox=""
          srcDoc={result.html ?? '<p>Sin contenido</p>'}
          style={{ flex: 1, minHeight: 420, border: 'none', borderRadius: '0 0 12px 12px' }}
        />
      </div>
    </div>
  )
}

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  sent: { label: 'Enviado', bg: '#dcfce7', color: '#166534' },
  failed: { label: 'Falló', bg: '#fee2e2', color: '#991b1b' },
  simulated: { label: 'Simulacro', bg: '#dbeafe', color: '#1e3a8a' },
  sending: { label: 'Enviando…', bg: '#fef9c3', color: '#854d0e' },
}

/** Historial de envíos de una novedad: cuándo, quién, por qué canal, resultado y motivo del error. */
export function EmailHistory({ recordId, refreshKey = 0 }: { recordId: string; refreshKey?: number }) {
  const [rows, setRows] = useState<DeliveryDTO[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getRecordEmailHistory(recordId).then((r) => { if (!cancelled) setRows(r) }).catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [open, recordId, refreshKey])

  return (
    <div style={{ marginTop: 12 }}>
      <button onClick={() => setOpen((v) => !v)} style={smallBtn}>{open ? '▾' : '▸'} Historial de envíos</button>
      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows === null && <span style={{ fontSize: 12, color: '#64748b' }}>Cargando…</span>}
          {rows?.length === 0 && <span style={{ fontSize: 12, color: '#64748b' }}>Esta novedad aún no tiene envíos.</span>}
          {rows?.map((d) => {
            const st = STATUS_STYLE[d.status] ?? { label: d.status, bg: '#f1f5f9', color: '#475569' }
            return (
              <div key={d.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#334155' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 10, fontWeight: 700, background: st.bg, color: st.color }}>{st.label}</span>
                  <span>{new Date(d.createdAt).toLocaleString('es-CO')}</span>
                  <span style={{ color: '#64748b' }}>· {MODE_NAMES[d.mode] ?? d.mode} · {d.channel}</span>
                  <span style={{ color: '#64748b' }}>· {d.triggeredByName ?? d.triggeredByEmail}</span>
                </div>
                {d.recipients.length > 0 && <div style={{ marginTop: 3 }}>Para: {list(d.recipients)}</div>}
                {d.resendReason && <div style={{ marginTop: 3 }}>Motivo del reenvío: {d.resendReason}</div>}
                {d.errorMessage && <div style={{ marginTop: 3, color: '#991b1b' }}>{d.errorCode ? `${ERROR_TITLES[d.errorCode as EmailErrorCode] ?? d.errorCode}: ` : ''}{d.errorMessage}</div>}
                {d.errorDetail && <div style={{ marginTop: 3, color: '#64748b', fontFamily: 'monospace', fontSize: 11 }}>{d.errorDetail}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
