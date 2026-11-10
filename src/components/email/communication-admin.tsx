'use client'

import { useCallback, useEffect, useState } from 'react'
import type { RuleRowDTO } from '@/lib/email/rules'
import type { PendingRow } from '@/lib/email/panel'
import { COMMUNICATION_MODES, MODE_LABELS, REQUIRABLE_FIELDS, type CommunicationMode } from '@/lib/email/communication'
import { getCommunicationRules, saveCommunicationRule, listPendingNovedades } from '@/lib/actions/email-admin'

const card = { background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: '16px 18px', marginBottom: 16 } as const
const btn = { padding: '7px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as const
const primary = { ...btn, background: '#1e2a3a', color: '#fff', border: 'none' } as const
const th = { padding: '8px 10px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#a0aec0' } as const
const td = { padding: '8px 10px', fontSize: 12, color: '#334155', verticalAlign: 'top' } as const
const sel = { padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 12 } as const

const MODE_HELP: Record<CommunicationMode, string> = {
  AUTO: 'Se envía sola cuando los campos obligatorios están completos (solo las novedades creadas desde que se activa).',
  MANUAL: 'Nunca sale sola: solo cuando alguien pulsa Ejecutar, y únicamente si los campos obligatorios están completos.',
  DISABLED: 'No se puede enviar, ni sola ni a mano.',
}
const MODE_COLORS: Record<CommunicationMode, { bg: string; color: string }> = {
  AUTO: { bg: '#dcfce7', color: '#166534' },
  MANUAL: { bg: '#dbeafe', color: '#1e3a8a' },
  DISABLED: { bg: '#f1f5f9', color: '#475569' },
}

type Draft = { mode: CommunicationMode; requiredFields: string[] }
const sameDraft = (a: Draft, b: Draft) => a.mode === b.mode && a.requiredFields.length === b.requiredFields.length && a.requiredFields.every((k) => b.requiredFields.includes(k))

type Sub = 'rules' | 'pending'

export function CommunicationAdmin() {
  const [sub, setSub] = useState<Sub>('rules')
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {([['rules', 'Reglas por tipo'], ['pending', 'Pendientes']] as [Sub, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)} style={{ ...btn, background: sub === k ? '#1e2a3a' : '#fff', color: sub === k ? '#fff' : '#334155' }}>{label}</button>
        ))}
      </div>
      {sub === 'rules' ? <RulesSection /> : <PendingSection />}
      <p style={{ fontSize: 12, color: '#64748b' }}>
        Los destinatarios del correo, las menciones en Google Chat, el historial de envíos y la reejecución están en la pestaña <b>✉️ Correos</b>. Los cambios de esta pestaña quedan en la <b>📋 Auditoría</b>.
      </p>
    </div>
  )
}

function RulesSection() {
  const [rules, setRules] = useState<RuleRowDTO[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [msgs, setMsgs] = useState<Record<string, { ok: boolean; text: string } | undefined>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const apply = useCallback((rows: RuleRowDTO[]) => {
    setRules(rows)
    setDrafts(Object.fromEntries(rows.map((r) => [r.tipo, { mode: r.mode, requiredFields: r.requiredFields }])))
  }, [])

  useEffect(() => {
    getCommunicationRules().then(apply).catch(() => setError('No se pudieron cargar las reglas.'))
  }, [apply])

  if (error) return <div style={{ ...card, color: '#991b1b' }}>{error}</div>
  if (!rules) return <div style={{ ...card, color: '#64748b' }}>Cargando…</div>

  async function save(rule: RuleRowDTO) {
    const d = drafts[rule.tipo]
    setSaving(rule.tipo)
    setMsgs((m) => ({ ...m, [rule.tipo]: undefined }))
    try {
      const res = await saveCommunicationRule({ tipo: rule.tipo, mode: d.mode, requiredFields: d.requiredFields })
      if (res.ok) {
        apply(res.data)
        setMsgs((m) => ({ ...m, [rule.tipo]: { ok: true, text: 'Guardado. Aplica desde el siguiente envío.' } }))
      } else {
        setMsgs((m) => ({ ...m, [rule.tipo]: { ok: false, text: res.error } }))
      }
    } catch {
      setMsgs((m) => ({ ...m, [rule.tipo]: { ok: false, text: 'No se pudo guardar. Intenta de nuevo.' } }))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div>
      <div style={{ ...card, fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
        <b style={{ color: '#1e293b' }}>Cómo funciona cada modo</b>
        {COMMUNICATION_MODES.map((m) => (
          <div key={m}><span style={{ ...MODE_COLORS[m], padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{MODE_LABELS[m]}</span> {MODE_HELP[m]}</div>
        ))}
        <div style={{ marginTop: 6 }}>El cambio aplica de ahí en adelante: nunca se envía nada retroactivo de forma automática, y lo ya comunicado no se toca.</div>
      </div>

      {rules.map((rule) => {
        const d = drafts[rule.tipo] ?? { mode: rule.mode, requiredFields: rule.requiredFields }
        const dirty = !sameDraft(d, { mode: rule.mode, requiredFields: rule.requiredFields })
        const msg = msgs[rule.tipo]
        return (
          <div key={rule.tipo} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <strong style={{ fontSize: 15, color: '#1e293b' }}>{rule.tipo}</strong>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                {rule.source === 'custom' ? `Configurado por ${rule.updatedByEmail ?? '—'} · ${rule.updatedAt ? new Date(rule.updatedAt).toLocaleString('es-CO') : ''}` : rule.source === 'default' ? 'Valores de fábrica' : 'Sin configurar (deshabilitado)'}
              </span>
            </div>

            <div role="radiogroup" aria-label={`Modo de envío de ${rule.tipo}`} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 6px' }}>
              {COMMUNICATION_MODES.map((m) => {
                const on = d.mode === m
                return (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={on}
                    onClick={() => setDrafts((x) => ({ ...x, [rule.tipo]: { ...d, mode: m } }))}
                    style={{ ...btn, background: on ? MODE_COLORS[m].bg : '#fff', color: on ? MODE_COLORS[m].color : '#334155', border: `1px solid ${on ? MODE_COLORS[m].color : '#cbd5e1'}` }}
                  >
                    {MODE_LABELS[m]}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>{MODE_HELP[d.mode]}</div>

            {d.mode !== 'DISABLED' && (
              <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', margin: 0 }}>
                <legend style={{ fontSize: 12, color: '#64748b', padding: '0 6px' }}>Campos obligatorios para enviar</legend>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '4px 12px' }}>
                  {REQUIRABLE_FIELDS.map((f) => (
                    <label key={f.key} style={{ fontSize: 12, color: '#334155', display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={d.requiredFields.includes(f.key)}
                        onChange={(e) => setDrafts((x) => ({ ...x, [rule.tipo]: { ...d, requiredFields: e.target.checked ? [...d.requiredFields, f.key] : d.requiredFields.filter((k) => k !== f.key) } }))}
                      />
                      {f.label}
                      {f.key === 'traeVideo' && <span style={{ color: '#94a3b8' }}> (si es Sí, exige Video)</span>}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
              <button onClick={() => save(rule)} disabled={!dirty || saving === rule.tipo} style={{ ...primary, opacity: !dirty || saving === rule.tipo ? 0.5 : 1, cursor: !dirty ? 'default' : 'pointer' }}>
                {saving === rule.tipo ? 'Guardando…' : 'Guardar'}
              </button>
              {dirty && <button onClick={() => setDrafts((x) => ({ ...x, [rule.tipo]: { mode: rule.mode, requiredFields: rule.requiredFields } }))} style={btn}>Descartar</button>}
              {msg && <span role="status" style={{ fontSize: 12, color: msg.ok ? '#166534' : '#991b1b' }}>{msg.text}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PendingSection() {
  const [rows, setRows] = useState<PendingRow[] | null>(null)
  const [tipo, setTipo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    listPendingNovedades({ tipo: tipo || undefined })
      .then((r) => { setRows(r); setError(null) })
      .catch(() => setError('No se pudieron cargar los pendientes.'))
  }, [tipo])
  useEffect(load, [load])

  const tipos = [...new Set((rows ?? []).map((r) => r.tipo))]
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ fontSize: 14, color: '#1e293b', marginRight: 6 }}>Novedades pendientes de comunicar</strong>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={sel} aria-label="Filtrar por tipo">
          <option value="">Todos los tipos</option>
          {(tipo && !tipos.includes(tipo) ? [tipo, ...tipos] : tipos).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={load} style={{ ...sel, cursor: 'pointer', fontWeight: 600 }}>↻ Actualizar</button>
      </div>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 10px' }}>
        Las más recientes de los tipos habilitados que aún no se han comunicado, y qué campo les falta. «Lista» = completa pero sin enviar (a la espera del envío manual o de un reintento).
      </p>
      {error && <div style={{ color: '#991b1b', fontSize: 13 }}>{error}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#1e2a3a' }}>{['Novedad', 'Tipo', 'Modo', 'Estado', 'Falta', 'Creada'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f0f4f8' }}>
                <td style={{ ...td, maxWidth: 320 }}><a href={`/app?record=${r.id}`} style={{ color: '#0f766e', fontWeight: 600 }}>{r.titulo}</a></td>
                <td style={td}>{r.tipo}</td>
                <td style={td}><span style={{ ...MODE_COLORS[r.mode], padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{MODE_LABELS[r.mode]}</span></td>
                <td style={td}>{r.state === 'incomplete' ? '⏳ Incompleta' : '🟢 Lista'}</td>
                <td style={{ ...td, maxWidth: 280 }}>{r.missing.length ? r.missing.join(', ') : '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{new Date(r.createdAt).toLocaleDateString('es-CO')}</td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', padding: 30, color: '#94a3b8' }}>No hay novedades pendientes. 🎉</td></tr>}
            {!rows && !error && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', padding: 30, color: '#94a3b8' }}>Cargando…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
