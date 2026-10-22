'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DeliveryDTO } from '@/lib/email/history'
import type { ShadowComparison } from '@/lib/email/admin-tools'
import { ERROR_TITLES, type EmailErrorCode } from '@/lib/email/errors'
import { listEmailDeliveriesAdmin, getEmailDeliveryDetail, getEmailShadowComparison } from '@/lib/actions/email-admin'

const card = { background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: '16px 18px', marginBottom: 16 } as const
const th = { padding: '8px 10px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#a0aec0' } as const
const td = { padding: '8px 10px', fontSize: 12, color: '#334155', verticalAlign: 'top' } as const
const sel = { padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 12 } as const

const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  sent: { label: 'Enviado', bg: '#dcfce7', color: '#166534' },
  failed: { label: 'Falló', bg: '#fee2e2', color: '#991b1b' },
  simulated: { label: 'Simulacro', bg: '#dbeafe', color: '#1e3a8a' },
  sending: { label: 'Enviando', bg: '#fef9c3', color: '#854d0e' },
}
const MODES: Record<string, string> = { live: 'En vivo', test: 'Prueba', webhook: 'Apps Script', shadow: 'Sombra', simulate: 'Simulacro', legacy: 'Histórico' }

export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, bg: '#f1f5f9', color: '#475569' }
  return <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{s.label}</span>
}

export function DeliveriesPanel() {
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState('')
  const [recordId, setRecordId] = useState('')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<{ total: number; deliveries: DeliveryDTO[] } | null>(null)
  const [detail, setDetail] = useState<DeliveryDTO | null>(null)
  const [shadow, setShadow] = useState<ShadowComparison | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    listEmailDeliveriesAdmin({ status: status || undefined, mode: mode || undefined, recordId: recordId.trim() || undefined, offset })
      .then((r) => { setData(r); setError(null) })
      .catch(() => setError('No se pudo cargar el historial.'))
  }, [status, mode, recordId, offset])

  useEffect(load, [load])
  useEffect(() => { getEmailShadowComparison().then(setShadow).catch(() => {}) }, [])

  async function open(id: string) {
    setDetail(await getEmailDeliveryDetail(id))
  }

  return (
    <div>
      {shadow && shadow.total > 0 && <ShadowSection shadow={shadow} onOpen={open} />}

      <div style={card}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          <strong style={{ fontSize: 14, color: '#1e293b', marginRight: 6 }}>Historial de envíos</strong>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0) }} style={sel}>
            <option value="">Todos los estados</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={mode} onChange={(e) => { setMode(e.target.value); setOffset(0) }} style={sel}>
            <option value="">Todos los modos</option>
            {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input value={recordId} onChange={(e) => { setRecordId(e.target.value); setOffset(0) }} placeholder="ID de la novedad" style={{ ...sel, width: 200 }} />
          <button onClick={load} style={{ ...sel, cursor: 'pointer', fontWeight: 600 }}>↻ Actualizar</button>
        </div>
        {error && <div style={{ color: '#991b1b', fontSize: 13 }}>{error}</div>}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#1e2a3a' }}>{['Fecha', 'Estado', 'Modo', 'Asunto', 'Para', 'Quién / canal', 'Motivo'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {data?.deliveries.map((d) => (
                <tr key={d.id} onClick={() => open(d.id)} style={{ borderBottom: '1px solid #f0f4f8', cursor: 'pointer' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{new Date(d.createdAt).toLocaleString('es-CO')}</td>
                  <td style={td}><StatusChip status={d.status} /></td>
                  <td style={td}>{MODES[d.mode] ?? d.mode}</td>
                  <td style={{ ...td, maxWidth: 260 }}>{d.subject ?? '—'}</td>
                  <td style={{ ...td, maxWidth: 200 }}>{d.recipients.slice(0, 2).join(', ')}{d.recipients.length > 2 ? ` +${d.recipients.length - 2}` : ''}</td>
                  <td style={td}>{d.triggeredByName ?? d.triggeredByEmail}<div style={{ color: '#94a3b8' }}>{d.channel} · {d.trigger}</div></td>
                  <td style={{ ...td, color: '#991b1b', maxWidth: 240 }}>{d.errorCode ? `${ERROR_TITLES[d.errorCode as EmailErrorCode] ?? d.errorCode}` : ''}</td>
                </tr>
              ))}
              {data && data.deliveries.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', padding: 30, color: '#94a3b8' }}>No hay envíos con esos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
        {data && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 12, color: '#64748b' }}>
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))} style={{ ...sel, cursor: offset === 0 ? 'default' : 'pointer' }}>‹ Anterior</button>
            <span>{data.total === 0 ? 0 : offset + 1}–{Math.min(offset + 25, data.total)} de {data.total}</span>
            <button disabled={offset + 25 >= data.total} onClick={() => setOffset(offset + 25)} style={{ ...sel, cursor: offset + 25 >= data.total ? 'default' : 'pointer' }}>Siguiente ›</button>
          </div>
        )}
      </div>

      {detail && <DeliveryDetail d={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

function ShadowSection({ shadow, onOpen }: { shadow: ShadowComparison; onOpen: (id: string) => void }) {
  return (
    <div style={card}>
      <strong style={{ fontSize: 14, color: '#1e293b' }}>Comparación en modo sombra</strong>
      <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 10px' }}>
        Por cada novedad: lo que hizo el Apps Script (envío real) frente al correo que la app habría enviado. «Sospechoso» = el script respondió 200 pero sin <code>success</code>: puede haber fallado por dentro.
      </p>
      <div style={{ display: 'flex', gap: 16, fontSize: 13, marginBottom: 10, flexWrap: 'wrap' }}>
        <span>Novedades: <b>{shadow.total}</b></span>
        <span style={{ color: '#166534' }}>Script OK: <b>{shadow.legacyOk}</b></span>
        <span style={{ color: '#991b1b' }}>Script falló: <b>{shadow.legacyFailed}</b></span>
        <span style={{ color: '#9a3412' }}>Sospechosos: <b>{shadow.suspicious}</b></span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#1e2a3a' }}>{['Novedad', 'Apps Script', 'Lo que enviaría la app', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {shadow.rows.map((r) => (
              <tr key={r.recordId} style={{ borderBottom: '1px solid #f0f4f8' }}>
                <td style={td}>{r.subject ?? r.recordId}<div style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{r.recordId}</div></td>
                <td style={td}>
                  {r.legacy ? <><StatusChip status={r.legacy.status} />{r.legacy.suspicious && <span style={{ color: '#9a3412', fontWeight: 700 }}> ⚠ sospechoso</span>}
                    <div style={{ color: '#64748b' }}>{new Date(r.legacy.at).toLocaleString('es-CO')} · {r.legacy.by}</div>
                    {r.legacy.response && <div style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{r.legacy.response}</div>}
                    {r.legacy.error && <div style={{ color: '#991b1b' }}>{r.legacy.error}</div>}</> : '—'}
                </td>
                <td style={td}>{r.simulated ? <>{r.simulated.subject}<div style={{ color: '#64748b' }}>Para: {r.simulated.recipients.join(', ')}</div></> : '—'}</td>
                <td style={td}>{r.simulated && <button onClick={() => onOpen(r.simulated!.deliveryId)} style={{ ...sel, cursor: 'pointer' }}>Ver correo</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function DeliveryDetail({ d, onClose }: { d: DeliveryDTO; onClose: () => void }) {
  const rows: [string, React.ReactNode][] = [
    ['Estado', <StatusChip key="s" status={d.status} />],
    ['Modo', MODES[d.mode] ?? d.mode],
    ['Novedad', d.recordId ?? '—'],
    ['Disparado por', `${d.triggeredByName ?? ''} <${d.triggeredByEmail}> · ${d.channel} · ${d.trigger}`],
    ['Asunto', d.subject ?? '—'],
    ['Para', d.recipients.join(', ') || '—'],
    ['Rechazados', d.rejected.join(', ') || '—'],
    ['Creado', new Date(d.createdAt).toLocaleString('es-CO')],
    ['Terminó', d.finishedAt ? `${new Date(d.finishedAt).toLocaleString('es-CO')} (${d.durationMs ?? '?'} ms)` : '—'],
    ['Motivo del reenvío', d.resendReason ?? '—'],
    ['Error', d.errorCode ? `${ERROR_TITLES[d.errorCode as EmailErrorCode] ?? d.errorCode}: ${d.errorMessage ?? ''}` : '—'],
    ['Detalle técnico', d.errorDetail ?? '—'],
    ['Respuesta del Apps Script', d.legacyResponse ?? '—'],
    ['Aviso a Chat', d.chatStatus ? `${d.chatStatus}${d.chatError ? ` — ${d.chatError}` : ''}` : '—'],
    ['Message-ID', d.messageId ?? '—'],
  ]
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Detalle del envío" style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 820, maxHeight: '92vh', overflowY: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <strong style={{ fontSize: 15 }}>Detalle del envío</strong>
          <button onClick={onClose} aria-label="Cerrar" style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 12, padding: '5px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}>
            <div style={{ width: 170, color: '#64748b' }}>{k}</div>
            <div style={{ flex: 1, color: '#1e293b', wordBreak: 'break-word' }}>{v}</div>
          </div>
        ))}
        {d.html && (
          <>
            <div style={{ fontSize: 12, color: '#64748b', margin: '12px 0 4px' }}>Correo renderizado</div>
            <iframe title="Correo del envío" sandbox="" srcDoc={d.html} style={{ width: '100%', height: 480, border: '1px solid #e2e8f0', borderRadius: 8 }} />
          </>
        )}
      </div>
    </div>
  )
}
