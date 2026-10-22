'use client'

import { useEffect, useState } from 'react'
import type { NovedadOption } from '@/lib/email/admin'
import type { SendResult } from '@/lib/email/service'
import { sendEmailTest, simulateEmailForRecord, listNovedadesForEmail, getEmailAdminState } from '@/lib/actions/email-admin'
import { EmailResultBanner, EmailPreviewModal } from './email-panels'

const card = { background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: '18px 20px', marginBottom: 16 } as const
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' } as const
const primary = { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#1e2a3a', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as const

export function TestTools() {
  const [novedades, setNovedades] = useState<NovedadOption[]>([])
  const [defaults, setDefaults] = useState<{ addresses: string; domains: string[]; max: number }>({ addresses: '', domains: ['alegra.com'], max: 5 })

  useEffect(() => {
    Promise.all([listNovedadesForEmail(), getEmailAdminState()]).then(([n, s]) => {
      setNovedades(n)
      setDefaults({ addresses: s.settings.testRecipients.join(', '), domains: s.limits.testDomains, max: s.limits.maxTestRecipients })
    }).catch(() => {})
  }, [])

  return (
    <div>
      <p style={{ fontSize: 13, color: '#718096', marginBottom: 14 }}>
        Prueba el correo sin riesgo: el <b>simulacro</b> genera el correo exacto de una novedad real sin enviar nada, y el <b>correo de prueba</b> lo envía de verdad pero solo a las direcciones que escribas.
      </p>
      <TestSend novedades={novedades} defaults={defaults} />
      <Simulate novedades={novedades} />
    </div>
  )
}

export function TestSend({ novedades, defaults }: { novedades: NovedadOption[]; defaults: { addresses: string; domains: string[]; max: number } }) {
  const [addresses, setAddresses] = useState(defaults.addresses)
  const [recordId, setRecordId] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)

  useEffect(() => setAddresses((a) => a || defaults.addresses), [defaults.addresses])

  async function send() {
    setSending(true)
    setResult(null)
    try {
      setResult(await sendEmailTest({ addresses, recordId: recordId || undefined }))
    } catch {
      setResult({ ok: false, status: 'failed', error: { code: 'UNKNOWN', message: 'No se pudo contactar al servidor. Reintenta.' } })
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={card}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1a202c', marginBottom: 4 }}>Enviar correo de prueba</h3>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
        Usa la plantilla guardada. Solo a direcciones @{defaults.domains.join(', @')} (máx. {defaults.max}); el asunto lleva <code>[TEST]</code> y nunca llega a los destinatarios reales.
      </p>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <label style={{ fontSize: 12, color: '#64748b' }}>Enviar a (separados por coma)
          <input value={addresses} onChange={(e) => setAddresses(e.target.value)} placeholder="tu.correo@alegra.com" style={inputStyle} />
        </label>
        <label style={{ fontSize: 12, color: '#64748b' }}>Con los datos de
          <select value={recordId} onChange={(e) => setRecordId(e.target.value)} style={inputStyle}>
            <option value="">Datos de ejemplo</option>
            {novedades.map((n) => <option key={n.id} value={n.id}>{n.titulo} ({n.tipo})</option>)}
          </select>
        </label>
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={send} disabled={sending || !addresses.trim()} style={{ ...primary, opacity: sending || !addresses.trim() ? 0.5 : 1 }}>{sending ? '⏳ Enviando…' : 'Enviar prueba'}</button>
      </div>
      {result && <div style={{ marginTop: 12 }}><EmailResultBanner result={result} isAdmin onClose={() => setResult(null)} onRetry={send} /></div>}
    </div>
  )
}

export function Simulate({ novedades }: { novedades: NovedadOption[] }) {
  const [recordId, setRecordId] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)
  const [preview, setPreview] = useState(false)

  async function run() {
    setRunning(true)
    setResult(null)
    try {
      const r = await simulateEmailForRecord(recordId)
      setResult(r)
      if (r.status === 'simulated') setPreview(true)
    } catch {
      setResult({ ok: false, status: 'failed', error: { code: 'UNKNOWN', message: 'No se pudo contactar al servidor. Reintenta.' } })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={card}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1a202c', marginBottom: 4 }}>Simular el envío de una novedad</h3>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
        Aplica las mismas validaciones y la misma plantilla que un envío real y muestra el correo exacto (asunto, destinatarios, cuerpo). <b>No envía nada ni marca la novedad como comunicada.</b>
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 12, color: '#64748b', flex: 1, minWidth: 260 }}>Novedad
          <select value={recordId} onChange={(e) => setRecordId(e.target.value)} style={inputStyle}>
            <option value="">Elige una novedad…</option>
            {novedades.map((n) => <option key={n.id} value={n.id}>{n.titulo} ({n.tipo})</option>)}
          </select>
        </label>
        <button onClick={run} disabled={running || !recordId} style={{ ...primary, opacity: running || !recordId ? 0.5 : 1 }}>{running ? 'Simulando…' : 'Simular envío'}</button>
      </div>
      {result && <div style={{ marginTop: 12 }}><EmailResultBanner result={result} isAdmin onClose={() => setResult(null)} onPreview={() => setPreview(true)} /></div>}
      {preview && result?.status === 'simulated' && <EmailPreviewModal result={result} onClose={() => setPreview(false)} />}
    </div>
  )
}
