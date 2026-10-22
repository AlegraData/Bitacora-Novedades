'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import type { TemplateState, PreviewResult, NovedadOption } from '@/lib/email/admin'
import {
  getEmailTemplateState, previewEmailTemplate, saveEmailTemplate, restoreEmailTemplateDefault,
  restoreEmailTemplateRevision, getEmailTemplateRevision, listNovedadesForEmail, getEmailAdminState, sendEmailTest,
} from '@/lib/actions/email-admin'
import type { SendResult } from '@/lib/email/service'
import { EmailResultBanner } from './email-panels'

const card = { background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: '16px 18px' } as const
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' } as const
const btn = { padding: '7px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as const
const primary = { ...btn, background: '#1e2a3a', color: '#fff', border: 'none' } as const

export function TemplateEditor() {
  const [state, setState] = useState<TemplateState | null>(null)
  const [novedades, setNovedades] = useState<NovedadOption[]>([])
  const [testRecipients, setTestRecipients] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getEmailTemplateState(), listNovedadesForEmail(), getEmailAdminState()])
      .then(([s, n, a]) => { setState(s); setNovedades(n); setTestRecipients(a.settings.testRecipients) })
      .catch(() => setError('No se pudo cargar la plantilla.'))
  }, [])

  if (error) return <div style={{ ...card, color: '#991b1b' }}>{error}</div>
  if (!state) return <div style={{ ...card, color: '#64748b' }}>Cargando…</div>
  return <EditorBody initial={state} novedades={novedades} testRecipients={testRecipients} onReload={async () => setState(await getEmailTemplateState())} />
}

export function EditorBody({ initial, novedades, testRecipients = [], onReload }: { initial: TemplateState; novedades: NovedadOption[]; testRecipients?: string[]; onReload: () => Promise<void> }) {
  const saved = initial.template
  const [subject, setSubject] = useState(saved.subject)
  const [html, setHtml] = useState(saved.html)
  const [recordId, setRecordId] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const area = useRef<HTMLTextAreaElement>(null)
  const [testTo, setTestTo] = useState(testRecipients.join(', '))
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<SendResult | null>(null)

  async function sendTest() {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await sendEmailTest({ addresses: testTo, recordId: recordId || undefined, subject, html }))
    } catch {
      setTestResult({ ok: false, status: 'failed', error: { code: 'UNKNOWN', message: 'No se pudo contactar al servidor. Reintenta.' } })
    } finally {
      setTesting(false)
    }
  }

  const dirty = subject !== saved.subject || html !== saved.html

  // Vista previa en vivo con el borrador (se espera a que termines de escribir).
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      const res = await previewEmailTemplate({ subject, html, recordId: recordId || undefined })
      if (cancelled) return
      if (res.ok) { setPreview(res.data); setPreviewError(null) } else setPreviewError(res.error)
    }, 600)
    return () => { cancelled = true; clearTimeout(t) }
  }, [subject, html, recordId])

  function insert(text: string) {
    const el = area.current
    if (!el) return setHtml((h) => h + text)
    const { selectionStart: a, selectionEnd: b } = el
    const next = html.slice(0, a) + text + html.slice(b)
    setHtml(next)
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = a + text.length })
  }

  function save() {
    startTransition(async () => {
      const res = await saveEmailTemplate({ subject, html })
      if (res.ok) { setMessage({ ok: true, text: `Guardada como versión ${res.data.version}.` }); await onReload() }
      else setMessage({ ok: false, text: res.error })
    })
  }

  function restoreOriginal() {
    if (!window.confirm('Se vuelve a la plantilla original de Alegra y se guarda como una versión nueva (el historial se conserva). ¿Continuar?')) return
    startTransition(async () => {
      const res = await restoreEmailTemplateDefault()
      if (res.ok) { setSubject(res.data.subject); setHtml(res.data.html); setMessage({ ok: true, text: 'Plantilla original restaurada.' }); await onReload() }
      else setMessage({ ok: false, text: res.error })
    })
  }

  function loadRevision(version: number) {
    startTransition(async () => {
      const res = await getEmailTemplateRevision(version)
      if (res.ok) { setSubject(res.data.subject); setHtml(res.data.html); setMessage({ ok: true, text: `Versión ${version} cargada en el editor (sin guardar).` }) }
      else setMessage({ ok: false, text: res.error })
    })
  }

  function restoreRevision(version: number) {
    if (!window.confirm(`Restaurar la versión ${version}? Se guarda como una versión nueva.`)) return
    startTransition(async () => {
      const res = await restoreEmailTemplateRevision(version)
      if (res.ok) { setSubject(res.data.subject); setHtml(res.data.html); setMessage({ ok: true, text: `Versión ${version} restaurada como la ${res.data.version}.` }); await onReload() }
      else setMessage({ ok: false, text: res.error })
    })
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: '#718096', marginBottom: 14 }}>
        Plantilla del correo de novedades ({saved.isDefault ? 'original de Alegra, sin editar' : `versión ${saved.version}`}
        {saved.updatedByEmail ? ` · editada por ${saved.updatedByEmail}` : ''}). Usa <code>{'{{variable}}'}</code> y <code>{'{{#if variable}}…{{/if}}'}</code> para lo opcional.
        Todo lo que viene de la novedad se escapa automáticamente; no se permite HTML sin escapar.
      </p>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))' }}>
        <div style={card}>
          <label style={{ fontSize: 12, color: '#64748b' }}>Asunto
            <input value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle} />
          </label>
          <div style={{ fontSize: 12, color: '#64748b', margin: '12px 0 4px' }}>Variables (clic para insertar)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {initial.variables.map((v) => (
              <button key={v.name} onClick={() => insert(`{{${v.name}}}`)} title={`${v.description}${v.optional ? ' (opcional)' : ''}`} style={{ ...btn, padding: '3px 8px', fontSize: 11, fontFamily: 'monospace' }}>
                {v.name}{v.optional ? '?' : ''}
              </button>
            ))}
          </div>
          <label style={{ fontSize: 12, color: '#64748b' }}>Cuerpo (HTML)
            <textarea ref={area} value={html} onChange={(e) => setHtml(e.target.value)} rows={24} spellCheck={false}
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.45, resize: 'vertical' }} />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <button onClick={save} disabled={!dirty || pending || !!previewError} style={{ ...primary, opacity: !dirty || pending || previewError ? 0.5 : 1 }}>{pending ? 'Guardando…' : 'Guardar como versión nueva'}</button>
            <button onClick={() => { setSubject(saved.subject); setHtml(saved.html) }} disabled={!dirty} style={{ ...btn, opacity: dirty ? 1 : 0.5 }}>Descartar cambios</button>
            <button onClick={restoreOriginal} disabled={pending} style={btn}>Restaurar la original</button>
            {dirty && <span style={{ fontSize: 12, color: '#b45309' }}>Cambios sin guardar</span>}
          </div>
          {message && <div style={{ marginTop: 8, fontSize: 13, color: message.ok ? '#166534' : '#991b1b' }}>{message.text}</div>}

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Enviar prueba con este borrador (sin guardarlo), con los datos elegidos en la vista previa</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="tu.correo@alegra.com" style={inputStyle} />
              <button onClick={sendTest} disabled={testing || !testTo.trim() || !!previewError} style={{ ...btn, whiteSpace: 'nowrap', opacity: testing || !testTo.trim() || previewError ? 0.5 : 1 }}>{testing ? '⏳ Enviando…' : 'Enviar prueba'}</button>
            </div>
            {testResult && <div style={{ marginTop: 8 }}><EmailResultBanner result={testResult} isAdmin onClose={() => setTestResult(null)} onRetry={sendTest} /></div>}
          </div>
        </div>

        <div style={card}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14, color: '#1e293b' }}>Vista previa</strong>
            <select value={recordId} onChange={(e) => setRecordId(e.target.value)} style={{ ...inputStyle, width: 'auto', maxWidth: 320 }}>
              <option value="">Datos de ejemplo</option>
              {novedades.map((n) => <option key={n.id} value={n.id}>{n.titulo} ({n.tipo})</option>)}
            </select>
          </div>
          {previewError ? (
            <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#991b1b', fontSize: 13 }}>❌ {previewError}</div>
          ) : preview ? (
            <>
              <div style={{ fontSize: 13, color: '#334155', marginBottom: 6 }}><b>Asunto:</b> {preview.subject}</div>
              <iframe title="Vista previa de la plantilla" sandbox="" srcDoc={preview.html} style={{ width: '100%', height: 560, border: '1px solid #e2e8f0', borderRadius: 8 }} />
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 12, color: '#64748b', cursor: 'pointer' }}>Versión en texto plano</summary>
                <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 8, borderRadius: 6 }}>{preview.text}</pre>
              </details>
            </>
          ) : <div style={{ fontSize: 13, color: '#64748b' }}>Generando vista previa…</div>}
        </div>
      </div>

      <div style={{ ...card, marginTop: 16 }}>
        <strong style={{ fontSize: 14, color: '#1e293b' }}>Versiones</strong>
        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          {initial.revisions.length === 0 && <span style={{ fontSize: 13, color: '#64748b' }}>Aún no hay versiones: se usa la plantilla original.</span>}
          {initial.revisions.map((r) => (
            <div key={r.version} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9', paddingBottom: 6 }}>
              <b style={{ width: 70 }}>v{r.version}{r.isActive ? ' ✅' : ''}</b>
              <span style={{ flex: 1, color: '#64748b' }}>{new Date(r.createdAt).toLocaleString('es-CO')} · {r.savedByEmail ?? 'original de Alegra'}</span>
              <button onClick={() => loadRevision(r.version)} disabled={pending} style={{ ...btn, padding: '3px 10px', fontSize: 12 }}>Cargar en el editor</button>
              {!r.isActive && <button onClick={() => restoreRevision(r.version)} disabled={pending} style={{ ...btn, padding: '3px 10px', fontSize: 12 }}>Restaurar</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
