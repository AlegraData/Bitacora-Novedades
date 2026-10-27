'use client'

import { useEffect, useState, useTransition } from 'react'
import type { AdminState } from '@/lib/email/admin'
import type { DeliveryMode } from '@/lib/email/settings'
import type { NotifyRecipient } from '@/lib/email/recipients'
import { getEmailAdminState, saveEmailSettings, verifyEmailConnection, resolveEmailRecipientIds, sendEmailChatTest } from '@/lib/actions/email-admin'
import { TemplateEditor } from './template-editor'
import { TestTools } from './test-tools'
import { DeliveriesPanel } from './deliveries-panel'

const card = { background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: '18px 20px', marginBottom: 16 } as const
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' } as const
const btn = { padding: '7px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as const
const primary = { ...btn, background: '#1e2a3a', color: '#fff', border: 'none' } as const

const MODE_HELP: Record<DeliveryMode, { title: string; text: string }> = {
  webhook: { title: 'Apps Script (legado)', text: 'Todo sigue como hoy: el Apps Script envía el correo y publica su tarjeta en Chat.' },
  shadow: { title: 'Sombra', text: 'El Apps Script sigue enviando de verdad. La app prepara en paralelo el mismo correo, sin enviarlo, para que lo compares en la pestaña Envíos.' },
  test: { title: 'Prueba', text: 'La app envía por SMTP, pero solo a los correos de prueba. Nada llega a los destinatarios reales ni se marca como comunicado.' },
  live: { title: 'En vivo', text: 'La app envía por SMTP a los destinatarios reales y avisa en el canal de Chat. El Apps Script deja de usarse.' },
}

function Chip({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700, background: ok ? '#dcfce7' : '#fee2e2', color: ok ? '#166534' : '#991b1b' }}>
      {children}
    </span>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
      <div style={{ width: 170, color: '#64748b' }}>{label}</div>
      <div style={{ flex: 1, color: '#1e293b' }}>{children}</div>
    </div>
  )
}

type Sub = 'config' | 'template' | 'tests' | 'deliveries'
const SUBTABS: [Sub, string][] = [
  ['config', 'Configuración'],
  ['template', 'Plantilla'],
  ['tests', 'Pruebas y simulacro'],
  ['deliveries', 'Envíos'],
]

export function EmailAdmin() {
  const [state, setState] = useState<AdminState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sub, setSub] = useState<Sub>('config')

  useEffect(() => {
    getEmailAdminState().then(setState).catch(() => setLoadError('No se pudo cargar la configuración de correos.'))
  }, [])

  if (loadError) return <div style={{ ...card, color: '#991b1b' }}>{loadError}</div>
  if (!state) return <div style={{ ...card, color: '#64748b' }}>Cargando…</div>

  return (
    <div>
      <p style={{ fontSize: 13, color: '#718096', marginBottom: 14 }}>
        Cómo salen los correos de las novedades. El modo se cambia al instante y sin desplegar: sirve también para volver atrás si algo no se ve bien.
      </p>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid #e2e8f0' }}>
        {SUBTABS.map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)} style={{ padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: sub === k ? '#00A888' : '#64748b', borderBottom: `2px solid ${sub === k ? '#00C4A0' : 'transparent'}`, marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>
      {sub === 'config' && <SettingsPanel state={state} onChange={(s) => setState({ ...state, settings: s })} />}
      {sub === 'template' && <TemplateEditor />}
      {sub === 'tests' && <TestTools />}
      {sub === 'deliveries' && <DeliveriesPanel />}
    </div>
  )
}

export function SettingsPanel({ state, onChange }: { state: AdminState; onChange: (s: AdminState['settings']) => void }) {
  const { settings, smtp } = state
  const [mode, setMode] = useState<DeliveryMode>(settings.mode)
  const [fromName, setFromName] = useState(settings.fromName)
  const [replyTo, setReplyTo] = useState(settings.replyTo ?? '')
  const [tests, setTests] = useState(settings.testRecipients.join(', '))
  const [rows, setRows] = useState<NotifyRecipient[]>(settings.recipients)
  const [newEmail, setNewEmail] = useState('')
  const [chatMsg, setChatMsg] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [chatTesting, setChatTesting] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [verify, setVerify] = useState<{ ok: boolean; text: string; detail?: string } | 'loading' | null>(null)
  const [pending, startTransition] = useTransition()

  const dirty =
    mode !== settings.mode || fromName !== settings.fromName || replyTo !== (settings.replyTo ?? '') || tests !== settings.testRecipients.join(', ') || JSON.stringify(rows) !== JSON.stringify(settings.recipients)

  function save() {
    if (mode !== settings.mode && mode === 'live' &&
      !window.confirm('A partir de ahora los correos de las novedades saldrán por SMTP a los destinatarios reales. ¿Continuar?')) return
    startTransition(async () => {
      const res = await saveEmailSettings({ mode, fromName, replyTo: replyTo.trim() || null, testRecipients: tests, recipients: rows })
      if (res.ok) {
        onChange(res.data)
        setMessage({ ok: true, text: 'Guardado.' })
      } else {
        setMessage({ ok: false, text: res.error + (res.detail ? ` (${res.detail})` : '') })
      }
    })
  }

  async function resolveIds() {
    setResolving(true)
    setChatMsg(null)
    try {
      const res = await resolveEmailRecipientIds(rows.filter((r) => r.mention !== false && !r.chatUserId).map((r) => r.email))
      const found = res.filter((r) => r.id)
      setRows(rows.map((r) => {
        const hit = found.find((x) => x.email === r.email)
        return hit ? { ...r, chatUserId: hit.id, name: r.name || hit.fullName } : r
      }))
      const bad = res.filter((r) => !r.id)
      setChatMsg(
        `IDs resueltos: ${found.length}.` +
          (bad.length ? ` No se pudo: ${bad.map((b) => `${b.email} (${b.error})`).join('; ')}.` : '') +
          (found.length ? ' Pulsa «Guardar cambios» para conservarlos.' : '')
      )
    } catch {
      setChatMsg('No se pudo consultar el IT Hub.')
    } finally {
      setResolving(false)
    }
  }

  async function chatTest() {
    const where = state.chat.testWebhookConfigured
      ? 'el espacio de PRUEBAS de Chat'
      : 'el canal REAL de Chat (tp-product-update); se notificará a las personas mencionadas'
    if (!window.confirm(`Se publicará un mensaje de prueba en ${where}. ¿Continuar?`)) return
    setChatTesting(true)
    setChatMsg(null)
    try {
      const r = await sendEmailChatTest()
      setChatMsg(
        r.ok
          ? `✅ Mensaje publicado en ${r.target === 'prueba' ? 'el espacio de pruebas' : 'el canal real'}. Mencionados: ${r.mentioned.join(', ') || 'nadie'}.` +
              (r.unresolved.length ? ` Sin ID (en texto, sin notificar): ${r.unresolved.map((u) => u.email).join(', ')}.` : '')
          : `❌ ${r.error ?? 'No se pudo publicar.'}`
      )
    } catch {
      setChatMsg('❌ No se pudo contactar al servidor.')
    } finally {
      setChatTesting(false)
    }
  }

  async function checkSmtp() {
    setVerify('loading')
    const res = await verifyEmailConnection()
    if (!res.ok) setVerify({ ok: false, text: res.error })
    else if (res.data.ok) setVerify({ ok: true, text: 'Conexión y credenciales correctas.' })
    else setVerify({ ok: false, text: res.data.message, detail: res.data.detail })
  }

  return (
    <>
      <div style={card}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1a202c', marginBottom: 10 }}>Modo de envío</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {state.modes.map((m) => {
            const needsSmtp = (m.id === 'test' || m.id === 'live') && !smtp.configured
            const needsHook = (m.id === 'webhook' || m.id === 'shadow') && !state.webhook.configured
            return (
              <label key={m.id} style={{ display: 'flex', gap: 10, padding: '10px 12px', border: `1.5px solid ${mode === m.id ? '#00C4A0' : '#e2e8f0'}`, borderRadius: 10, background: mode === m.id ? '#f0fdfa' : '#fff', cursor: 'pointer' }}>
                <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} style={{ marginTop: 3, accentColor: '#00C4A0' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                    {MODE_HELP[m.id].title} {settings.mode === m.id && <span style={{ color: '#00A888', fontWeight: 600 }}>· actual</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{MODE_HELP[m.id].text}</div>
                  {needsSmtp && <div style={{ fontSize: 12, color: '#b45309', marginTop: 2 }}>⚠ Requiere el SMTP configurado (ver el estado de abajo).</div>}
                  {needsHook && <div style={{ fontSize: 12, color: '#b45309', marginTop: 2 }}>⚠ No se encontró el campo botón con la URL del Apps Script.</div>}
                </div>
              </label>
            )
          })}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1a202c', marginBottom: 4 }}>Destinatarios de la notificación</h3>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
          El correo de cada novedad se envía <b>solo</b> a estas personas (ya no a «Correos a comunicar» del registro). Si una persona tiene ID de Chat y «Mencionar en Chat» está marcado, la tarjeta del canal la menciona; un grupo (como tm-alegra) recibe el correo sin que se mencione. Solo se comunican las Novedades y las Pre-novedades.
          {!settings.recipientsCustomized && ' Ahora se usa la lista por defecto; al guardar queda como tuya.'}
          {' '}En los modos Apps Script y Sombra el script sigue enviando a «Correos a comunicar»: esta lista aplica en En vivo.
        </p>
        <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
          {rows.map((r, i) => (
            <div key={r.email} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.4fr) minmax(140px, 1fr) minmax(170px, 1fr) auto auto', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#1e293b', wordBreak: 'break-all' }}>{r.email}</span>
              <input value={r.name ?? ''} placeholder="Nombre" maxLength={80} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} style={inputStyle} />
              <input value={r.chatUserId ?? ''} placeholder="ID de Chat (opcional)" inputMode="numeric" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, chatUserId: e.target.value.replace(/[^0-9]/g, '') || undefined } : x)))} style={{ ...inputStyle, fontFamily: 'monospace' }} />
              <label title="Si está apagado, no se menciona en la tarjeta de Chat ni se busca su ID (ideal para un grupo)" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#475569', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={r.mention !== false} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, mention: e.target.checked ? undefined : false } : x)))} />
                Mencionar en Chat
              </label>
              <button onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length <= 1} title={rows.length <= 1 ? 'Debe quedar al menos uno' : 'Quitar'} style={{ ...btn, padding: '5px 10px', opacity: rows.length <= 1 ? 0.4 : 1 }}>✕</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="agregar.correo@alegra.com" style={inputStyle} />
          <button
            onClick={() => {
              const email = newEmail.trim().toLowerCase()
              if (email && !rows.some((r) => r.email === email)) setRows([...rows, { email }])
              setNewEmail('')
            }}
            disabled={!newEmail.trim()}
            style={{ ...btn, whiteSpace: 'nowrap', opacity: newEmail.trim() ? 1 : 0.5 }}
          >
            Agregar
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '-6px 0 18px' }}>
          <button onClick={resolveIds} disabled={resolving || !state.itHub.configured || rows.every((r) => r.mention === false || r.chatUserId)} title={state.itHub.configured ? undefined : 'Falta IT_HUB_URL / IT_HUB_API_KEY'} style={{ ...btn, opacity: resolving || !state.itHub.configured || rows.every((r) => r.mention === false || r.chatUserId) ? 0.5 : 1 }}>
            {resolving ? 'Consultando…' : 'Resolver IDs de Chat'}
          </button>
          <button onClick={chatTest} disabled={chatTesting || dirty || !state.chat.configured} title={dirty ? 'Guarda los cambios antes de probar' : undefined} style={{ ...btn, opacity: chatTesting || dirty || !state.chat.configured ? 0.5 : 1 }}>
            {chatTesting ? 'Publicando…' : '💬 Mensaje de prueba en Chat'}
          </button>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            {state.itHub.configured ? 'IT Hub conectado.' : 'IT Hub sin configurar.'} {state.chat.testWebhookConfigured ? 'La prueba va a un espacio de pruebas.' : 'La prueba va al canal real y menciona a estas personas.'}
          </span>
        </div>
        {chatMsg && <div style={{ fontSize: 13, color: chatMsg.startsWith('❌') ? '#991b1b' : '#334155', margin: '-10px 0 16px' }}>{chatMsg}</div>}

        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1a202c', marginBottom: 10 }}>Remitente y pruebas</h3>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <label style={{ fontSize: 12, color: '#64748b' }}>Nombre visible del remitente
            <input value={fromName} onChange={(e) => setFromName(e.target.value)} maxLength={60} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12, color: '#64748b' }}>Responder a (opcional)
            <input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="equipo@alegra.com" style={inputStyle} />
          </label>
        </div>
        <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginTop: 12 }}>
          Correos de prueba (máx. {state.limits.maxTestRecipients}, solo @{state.limits.testDomains.join(', @')}), separados por coma
          <input value={tests} onChange={(e) => setTests(e.target.value)} placeholder="tu.correo@alegra.com" style={inputStyle} />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <button onClick={save} disabled={!dirty || pending} style={{ ...primary, opacity: !dirty || pending ? 0.5 : 1 }}>{pending ? 'Guardando…' : 'Guardar cambios'}</button>
          {message && <span style={{ fontSize: 13, color: message.ok ? '#166534' : '#991b1b' }}>{message.text}</span>}
        </div>
        {settings.updatedAt && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Última modificación: {new Date(settings.updatedAt).toLocaleString('es-CO')}{settings.updatedByEmail ? ` por ${settings.updatedByEmail}` : ''}</div>}
      </div>

      <div style={card}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1a202c', marginBottom: 6 }}>Servidor de correo (SMTP)</h3>
        <Row label="Estado">{smtp.configured ? <Chip ok>Configurado</Chip> : <Chip ok={false}>Falta configurar</Chip>}</Row>
        <Row label="Servidor">{smtp.host ?? '—'}:{smtp.port}</Row>
        <Row label="Cuenta remitente">{smtp.fromEmail ?? '—'}</Row>
        <Row label="Contraseña">{smtp.hasPassword ? <Chip ok>Cargada (no se muestra)</Chip> : <Chip ok={false}>No cargada</Chip>}</Row>
        {smtp.missing.length > 0 && (
          <div style={{ fontSize: 12, color: '#b45309', padding: '8px 0' }}>
            Faltan estas variables de entorno en Cloud Run: <b>{smtp.missing.join(', ')}</b>. La contraseña de aplicación se carga como secreto del servicio; nunca se guarda ni se muestra aquí.
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <button onClick={checkSmtp} disabled={verify === 'loading'} style={btn}>{verify === 'loading' ? 'Verificando…' : 'Verificar conexión'}</button>
          {verify && verify !== 'loading' && <span style={{ fontSize: 13, color: verify.ok ? '#166534' : '#991b1b' }}>{verify.ok ? '✅ ' : '❌ '}{verify.text}</span>}
        </div>
        {verify && verify !== 'loading' && verify.detail && <pre style={{ marginTop: 8, padding: 8, background: '#f8fafc', borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap', color: '#475569' }}>{verify.detail}</pre>}
      </div>

      <div style={card}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1a202c', marginBottom: 6 }}>Integraciones</h3>
        <Row label="Aviso a Google Chat">{state.chat.configured ? <><Chip ok>Configurado</Chip> <span style={{ color: '#64748b' }}>{state.chat.host}</span></> : <Chip ok={false}>Sin canal (PMKT_CHAT_WEBHOOK_URL)</Chip>}</Row>
        <Row label="Apps Script (legado)">{state.webhook.configured ? <Chip ok>Botón con URL configurada</Chip> : <Chip ok={false}>No configurado</Chip>}</Row>
        <Row label="Dominio de los links">{state.appUrl}</Row>
        <div style={{ fontSize: 12, color: '#94a3b8', paddingTop: 8 }}>En modo En vivo la app publica la tarjeta de Chat; en los demás modos la sigue publicando el Apps Script.</div>
      </div>
    </>
  )
}
