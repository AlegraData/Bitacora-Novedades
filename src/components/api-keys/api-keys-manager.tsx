'use client'

import { Fragment, useEffect, useState, useTransition } from 'react'
import type { ApiKeyDTO, ApiKeyUsage } from '@/lib/api/keys'
import {
  ALL_SCOPES,
  ADMIN_ONLY_SCOPES,
  EXPIRY_OPTIONS_DAYS,
  DEFAULT_EXPIRY_DAYS,
  MAX_KEYS_PER_USER,
  SCOPES,
  API_BASE_URL,
  type Scope,
} from '@/lib/api/constants'
import {
  createApiKeyAction,
  updateApiKeyAction,
  revokeApiKeyAction,
  getApiKeyUsageAction,
} from '@/lib/actions/api-keys'
import { CodeBlock } from './ui'

interface Props {
  initialKeys: ApiKeyDTO[]
  /** 'admin' muestra los tokens de toda la organización; 'user' solo los propios. */
  mode: 'admin' | 'user'
  isAdmin: boolean
  currentUserEmail: string
}

const STATUS_STYLE = {
  active: { label: 'Activo', bg: '#c6f6d5', color: '#276749' },
  expired: { label: 'Expirado', bg: '#feebc8', color: '#9c4221' },
  revoked: { label: 'Revocado', bg: '#fed7d7', color: '#9b2c2c' },
} as const

const card = { background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflow: 'hidden' } as const
const th = { padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#a0aec0' } as const
const btn = { padding: '5px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#4a5568', fontSize: 12, fontWeight: 600, cursor: 'pointer' } as const
const input = { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' } as const

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('es-CO') : 'Nunca'
}

function ScopeChecklist({ value, onChange, isAdmin }: { value: Scope[]; onChange: (v: Scope[]) => void; isAdmin: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {ALL_SCOPES.map((s) => {
        const locked = ADMIN_ONLY_SCOPES.includes(s) && !isAdmin
        return (
          <label key={s} style={{ display: 'flex', gap: 8, fontSize: 13, color: locked ? '#a0aec0' : '#2d3748', alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              disabled={locked}
              checked={value.includes(s)}
              onChange={(e) => onChange(e.target.checked ? [...value, s] : value.filter((x) => x !== s))}
              style={{ marginTop: 2, accentColor: '#00C4A0' }}
            />
            <span>
              <code style={{ fontWeight: 600 }}>{s}</code> — {SCOPES[s]}
              {locked && ' (solo ADMIN)'}
            </span>
          </label>
        )
      })}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose?: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={title} style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1a202c' }}>{title}</h3>
          {onClose && <button onClick={onClose} aria-label="Cerrar" style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer' }}>×</button>}
        </div>
        {children}
      </div>
    </div>
  )
}

function UsagePanel({ keyId }: { keyId: string }) {
  const [usage, setUsage] = useState<ApiKeyUsage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getApiKeyUsageAction(keyId).then((r) => {
      if (cancelled) return
      if (r.ok) setUsage(r.data)
      else setError(r.error)
    })
    return () => {
      cancelled = true
    }
  }, [keyId])

  if (error) return <p style={{ fontSize: 13, color: '#c53030' }}>{error}</p>
  if (!usage) return <p style={{ fontSize: 13, color: '#718096' }}>Cargando uso…</p>

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13, color: '#4a5568' }}>
        <span><strong>{usage.last24h}</strong> requests (24 h)</span>
        <span><strong>{usage.last7d}</strong> requests (7 días)</span>
        <span>
          Respuestas (7 d):{' '}
          {Object.entries(usage.byStatus).map(([s, n]) => (
            <span key={s} style={{ marginRight: 8, color: s.startsWith('2') ? '#276749' : '#9b2c2c', fontWeight: 600 }}>{s}×{n}</span>
          ))}
          {Object.keys(usage.byStatus).length === 0 && '—'}
        </span>
        <span>IPs (7 d): {usage.ips.length ? usage.ips.join(', ') : '—'}</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>{['Fecha', 'Método', 'Ruta', 'Estado', 'IP', 'Cliente (User-Agent)', 'ms'].map((h) => <th key={h} style={{ ...th, padding: '6px 8px', color: '#718096' }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {usage.recent.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid #edf2f7' }}>
              <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{fmt(r.timestamp)}</td>
              <td style={{ padding: '6px 8px' }}>{r.method}</td>
              <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{r.path}</td>
              <td style={{ padding: '6px 8px', fontWeight: 600, color: r.status < 400 ? '#276749' : '#9b2c2c' }}>{r.status}</td>
              <td style={{ padding: '6px 8px' }}>{r.ip ?? '—'}</td>
              <td style={{ padding: '6px 8px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.userAgent ?? ''}>{r.userAgent ?? '—'}</td>
              <td style={{ padding: '6px 8px' }}>{r.durationMs}</td>
            </tr>
          ))}
          {usage.recent.length === 0 && (
            <tr><td colSpan={7} style={{ padding: 12, color: '#a0aec0', textAlign: 'center' }}>Este token aún no se ha usado.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export function ApiKeysManager({ initialKeys, mode, isAdmin, currentUserEmail }: Props) {
  const [keys, setKeys] = useState<ApiKeyDTO[]>(initialKeys)
  const [filter, setFilter] = useState<'active' | 'all'>('active')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<ApiKeyDTO | null>(null)
  const [creating, setCreating] = useState(false)
  const [revealed, setRevealed] = useState<{ token: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const mineActive = keys.filter((k) => k.ownerEmail === currentUserEmail && k.status === 'active').length
  const limitReached = mineActive >= MAX_KEYS_PER_USER
  const visible = keys.filter((k) => (filter === 'all' ? true : k.status === 'active'))

  function replace(updated: ApiKeyDTO) {
    setKeys((prev) => prev.map((k) => (k.id === updated.id ? { ...k, ...updated, ownerName: k.ownerName } : k)))
  }

  function revoke(k: ApiKeyDTO) {
    if (!window.confirm(`¿Revocar "${k.name}"? Dejará de funcionar de inmediato y no se puede deshacer.`)) return
    startTransition(async () => {
      const r = await revokeApiKeyAction(k.id)
      if (!r.ok) return setError(r.error)
      setError(null)
      setKeys((prev) => prev.map((x) => (x.id === k.id ? { ...x, status: 'revoked', revokedAt: new Date().toISOString() } : x)))
    })
  }

  return (
    <div>
      {error && <div style={{ padding: '8px 14px', background: '#fed7d7', borderRadius: 8, marginBottom: 12, fontSize: 13, color: '#9b2c2c' }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {([['active', 'Activos'], ['all', 'Todos']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} style={{ ...btn, background: filter === k ? '#1e2a3a' : '#fff', color: filter === k ? '#fff' : '#4a5568' }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: limitReached ? '#c53030' : '#718096' }}>
            Tus tokens activos: {mineActive}/{MAX_KEYS_PER_USER}
          </span>
          <button
            onClick={() => setCreating(true)}
            disabled={limitReached}
            title={limitReached ? 'Revoca un token para crear otro' : undefined}
            style={{ ...btn, background: limitReached ? '#e2e8f0' : '#00C4A0', color: limitReached ? '#a0aec0' : '#fff', border: 'none', cursor: limitReached ? 'not-allowed' : 'pointer' }}
          >
            ＋ Nuevo token
          </button>
        </div>
      </div>

      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#1e2a3a' }}>
              {[mode === 'admin' ? 'Token / Dueño' : 'Token', 'Permisos', 'Estado', 'Último uso', 'Usos', 'Expira', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.map((k) => {
              const st = STATUS_STYLE[k.status]
              const canManage = k.status === 'active'
              return (
                <Fragment key={k.id}>
                  <tr style={{ borderBottom: '1px solid #f0f4f8' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1a202c' }}>{k.name}</div>
                      <div style={{ fontSize: 11, color: '#a0aec0', fontFamily: 'monospace' }}>{k.prefix}…</div>
                      {k.description && <div style={{ fontSize: 12, color: '#718096' }}>{k.description}</div>}
                      {mode === 'admin' && <div style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>{k.ownerName ?? k.ownerEmail} · {k.ownerEmail}</div>}
                    </td>
                    <td style={{ padding: '12px 16px', maxWidth: 240 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {k.scopes.map((s) => (
                          <span key={s} style={{ padding: '2px 6px', borderRadius: 4, background: s === 'records:delete' ? '#fed7d7' : '#bee3f8', color: s === 'records:delete' ? '#9b2c2c' : '#2c5282', fontSize: 11, fontWeight: 600 }}>{s}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color }}>{st.label}</span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#718096' }}>
                      <div>{fmt(k.lastUsedAt)}</div>
                      {k.lastUsedIp && <div style={{ fontSize: 11, color: '#a0aec0' }}>{k.lastUsedIp}</div>}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#4a5568' }}>{k.useCount}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#718096' }}>{new Date(k.expiresAt).toLocaleDateString('es-CO')}</td>
                    <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setExpanded(expanded === k.id ? null : k.id)} style={btn}>{expanded === k.id ? 'Ocultar uso' : 'Ver uso'}</button>
                        {canManage && <button onClick={() => setEditing(k)} style={btn}>Editar</button>}
                        {canManage && (
                          <button onClick={() => revoke(k)} disabled={pending} style={{ ...btn, border: '1px solid #fc8181', color: '#c53030', opacity: pending ? 0.6 : 1 }}>Revocar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded === k.id && (
                    <tr style={{ background: '#f7fafc' }}>
                      <td colSpan={7} style={{ padding: '14px 16px' }}><UsagePanel keyId={k.id} /></td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {visible.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#a0aec0' }}>
                {filter === 'active' ? 'No hay tokens activos.' : 'No hay tokens.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateDialog
          isAdmin={isAdmin}
          onClose={() => setCreating(false)}
          onCreated={(token, key) => {
            setKeys((prev) => [key, ...prev])
            setCreating(false)
            setRevealed({ token, name: key.name })
          }}
        />
      )}
      {editing && (
        <EditDialog
          k={editing}
          isAdmin={isAdmin}
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            replace(u)
            setEditing(null)
          }}
        />
      )}
      {revealed && (
        <Modal title="Tu token se creó">
          <p style={{ fontSize: 13, color: '#9c4221', background: '#feebc8', padding: '8px 12px', borderRadius: 8, marginBottom: 10 }}>
            <strong>Cópialo ahora.</strong> Por seguridad solo se muestra esta vez; después únicamente verás sus primeros caracteres. Si lo pierdes, revócalo y crea otro.
          </p>
          <p style={{ fontSize: 13, color: '#4a5568' }}>Token «{revealed.name}»:</p>
          <CodeBlock code={revealed.token} />
          <p style={{ fontSize: 13, color: '#4a5568', marginTop: 12 }}>Pruébalo:</p>
          <CodeBlock code={`curl -H "Authorization: Bearer ${revealed.token}" ${API_BASE_URL}/me`} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={() => setRevealed(null)} style={{ ...btn, background: '#1e2a3a', color: '#fff', border: 'none', padding: '8px 16px' }}>Ya lo guardé</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function CreateDialog({ isAdmin, onClose, onCreated }: { isAdmin: boolean; onClose: () => void; onCreated: (token: string, key: ApiKeyDTO) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scopes, setScopes] = useState<Scope[]>(['records:read'])
  const [days, setDays] = useState<number>(DEFAULT_EXPIRY_DAYS)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    startTransition(async () => {
      const r = await createApiKeyAction({ name, description, scopes, expiresInDays: days })
      if (!r.ok) return setError(r.error)
      onCreated(r.data.token, r.data.key)
    })
  }

  return (
    <Modal title="Nuevo token de API" onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ fontSize: 13, color: '#4a5568' }}>Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Ej. Script reverse-sync Mejoras" style={input} />
        </label>
        <label style={{ fontSize: 13, color: '#4a5568' }}>Descripción (opcional)
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} style={input} />
        </label>
        <div style={{ fontSize: 13, color: '#4a5568' }}>Permisos
          <div style={{ marginTop: 6 }}><ScopeChecklist value={scopes} onChange={setScopes} isAdmin={isAdmin} /></div>
          <p style={{ fontSize: 11, color: '#a0aec0', marginTop: 6 }}>Da solo lo necesario. El token actúa con tu mismo rol y respeta tus permisos.</p>
        </div>
        <label style={{ fontSize: 13, color: '#4a5568' }}>Vigencia
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={input}>
            {EXPIRY_OPTIONS_DAYS.map((d) => <option key={d} value={d}>{d} días</option>)}
          </select>
        </label>
        {error && <p style={{ fontSize: 13, color: '#c53030' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={btn}>Cancelar</button>
          <button onClick={submit} disabled={pending || !name.trim() || scopes.length === 0} style={{ ...btn, background: '#00C4A0', color: '#fff', border: 'none', padding: '8px 16px', opacity: pending || !name.trim() || scopes.length === 0 ? 0.6 : 1 }}>
            {pending ? 'Creando…' : 'Crear token'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function EditDialog({ k, isAdmin, onClose, onSaved }: { k: ApiKeyDTO; isAdmin: boolean; onClose: () => void; onSaved: (k: ApiKeyDTO) => void }) {
  const [name, setName] = useState(k.name)
  const [description, setDescription] = useState(k.description ?? '')
  const [scopes, setScopes] = useState<Scope[]>(k.scopes)
  const [days, setDays] = useState<number | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    startTransition(async () => {
      const r = await updateApiKeyAction(k.id, {
        name,
        description,
        scopes,
        ...(isAdmin && days !== '' ? { expiresInDays: days } : {}),
      })
      if (!r.ok) return setError(r.error)
      onSaved(r.data)
    })
  }

  return (
    <Modal title={`Editar «${k.name}»`} onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ fontSize: 13, color: '#4a5568' }}>Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} style={input} />
        </label>
        <label style={{ fontSize: 13, color: '#4a5568' }}>Descripción
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} style={input} />
        </label>
        <div style={{ fontSize: 13, color: '#4a5568' }}>Permisos
          <div style={{ marginTop: 6 }}><ScopeChecklist value={scopes} onChange={setScopes} isAdmin={isAdmin || k.scopes.includes('records:delete')} /></div>
        </div>
        {isAdmin && (
          <label style={{ fontSize: 13, color: '#4a5568' }}>Extender vigencia (desde hoy)
            <select value={days} onChange={(e) => setDays(e.target.value === '' ? '' : Number(e.target.value))} style={input}>
              <option value="">Sin cambios (expira {new Date(k.expiresAt).toLocaleDateString('es-CO')})</option>
              {EXPIRY_OPTIONS_DAYS.map((d) => <option key={d} value={d}>{d} días</option>)}
            </select>
          </label>
        )}
        <p style={{ fontSize: 11, color: '#a0aec0' }}>El valor del token no se puede ver ni cambiar. Para rotarlo, revócalo y crea uno nuevo.</p>
        {error && <p style={{ fontSize: 13, color: '#c53030' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={btn}>Cancelar</button>
          <button onClick={submit} disabled={pending || !name.trim() || scopes.length === 0} style={{ ...btn, background: '#1e2a3a', color: '#fff', border: 'none', padding: '8px 16px', opacity: pending ? 0.6 : 1 }}>
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
