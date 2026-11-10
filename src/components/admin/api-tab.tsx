'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Activity, KeyRound, ShieldAlert, Users } from 'lucide-react'
import type { ApiOverviewDTO, ApiActivityPage, ApiPersonDTO, ApiTokenRowDTO } from '@/lib/admin/api-dashboard'
import type { ApiKeyDTO } from '@/lib/api/keys'
import { SCOPES } from '@/lib/api/constants'
import { DEFAULT_PAGE_SIZE, type PageSize } from '@/lib/admin/table'
import { RESULT_LABELS, timeAgo } from '@/lib/admin/labels'
import { getApiOverviewAction, getApiActivityPage } from '@/lib/actions/admin-data'
import { revokeApiKeyAction } from '@/lib/actions/api-keys'
import { ApiKeysManager } from '@/components/api-keys/api-keys-manager'
import {
  Badge, BarList, DayBars, FilterSelect, PersonCell, Pagination, SearchBox, SectionHeader, SimpleTable, StatCard, StatGrid,
  card, colors, useDebounced, type Column, type Tone,
} from './ui'
import { PeopleTable } from './people-table'

const RESULT_TONE: Record<string, Tone> = { ok: 'green', denied: 'amber', error: 'red' }
const TOKEN_STATUS: Record<ApiTokenRowDTO['status'], { label: string; tone: Tone }> = {
  active: { label: 'Vigente', tone: 'green' }, expiring: { label: 'Vence pronto', tone: 'amber' }, expired: { label: 'Vencido', tone: 'gray' }, revoked: { label: 'Revocado', tone: 'red' },
}
const PERIOD_OPTIONS = [{ value: '7', label: 'Últimos 7 días' }, { value: '30', label: 'Últimos 30 días' }, { value: '90', label: 'Últimos 90 días' }]

export function ApiTab({ apiKeys, currentUserEmail }: { apiKeys: ApiKeyDTO[]; currentUserEmail: string }) {
  const [period, setPeriod] = useState('7')
  const [overview, setOverview] = useState<ApiOverviewDTO | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    getApiOverviewAction(Number(period)).then((o) => { setOverview(o); setError(null) }).catch(() => setError('No se pudo cargar el dashboard de la API.'))
  }, [period])
  useEffect(load, [load])

  if (error) return <div style={{ ...card, padding: 20, color: '#991b1b' }}>{error}</div>
  if (!overview) return <div style={{ ...card, padding: 40, textAlign: 'center', color: colors.faint }}>Cargando…</div>

  const failed = overview.results.denied + overview.results.error
  return (
    <div>
      <SectionHeader
        title="API Tokens"
        description={<>Tokens de la API REST (<code>/api/v1</code>) de toda la organización. Cada token actúa con el rol de su dueño y limitado a sus permisos (scopes). Revocar corta el acceso de inmediato. Cada persona puede tener máximo 3 tokens vigentes y crear los suyos en <a href="/api-tokens" style={{ color: colors.tealDark }}>/api-tokens</a>.</>}
        right={<FilterSelect label="Período" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />}
      />
      <StatGrid>
        <StatCard label="Personas con token" value={overview.people} icon={<Users size={18} />} tone="blue" />
        <StatCard label="Tokens vigentes" value={overview.activeTokens} icon={<KeyRound size={18} />} tone="green" />
        <StatCard label={`Requests (${overview.period} d)`} value={overview.requests} icon={<Activity size={18} />} tone="violet" />
        <StatCard label="Denegados o con error" value={failed} icon={<ShieldAlert size={18} />} tone={failed ? 'amber' : 'gray'} hint={`${overview.results.denied} denegados · ${overview.results.error} con error`} />
      </StatGrid>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 20 }}>
        <div style={{ ...card, padding: 18 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px' }}>Tokens por permiso</h3>
          <BarList items={overview.byScope.map((s) => ({ label: s.scope, value: s.count }))} empty="No hay tokens vigentes." />
        </div>
        <div style={{ ...card, padding: 18 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px' }}>Resultado de los requests</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <Badge tone="green">Correcto · {overview.results.ok}</Badge>
            <Badge tone="amber">Denegado · {overview.results.denied}</Badge>
            <Badge tone="red">Error · {overview.results.error}</Badge>
          </div>
          <p style={{ fontSize: 12, color: colors.muted, margin: 0, lineHeight: 1.5 }}>
            Denegado = sin token válido (401), sin el permiso necesario (403) o límite de uso superado (429). Error = el resto de 4xx y los 5xx.
          </p>
        </div>
        <div style={{ ...card, padding: 18 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px' }}>Requests por día</h3>
          <DayBars days={overview.perDay.map((d) => ({ label: d.label, value: d.value }))} />
        </div>
      </div>

      <PeopleSection overview={overview} onChanged={load} />
      <ActivitySection period={overview.period} />

      <details style={{ ...card, padding: '14px 18px', marginTop: 22 }}>
        <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 700, color: colors.text }}>Gestión avanzada de tokens (crear, editar y ver uso por token)</summary>
        <div style={{ marginTop: 14 }}>
          <ApiKeysManager initialKeys={apiKeys} mode="admin" isAdmin currentUserEmail={currentUserEmail} />
        </div>
      </details>
    </div>
  )
}

function PeopleSection({ overview, onChanged }: { overview: ApiOverviewDTO; onChanged: () => void }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function revoke(t: ApiTokenRowDTO) {
    if (!window.confirm(`¿Revocar el token «${t.name}»? Deja de funcionar de inmediato y no se puede deshacer.`)) return
    start(async () => {
      const res = await revokeApiKeyAction(t.id)
      setMessage(res.ok ? null : res.error)
      onChanged()
    })
  }

  const subColumns: Column<ApiTokenRowDTO>[] = [
    { key: 'name', header: 'Token', render: (t) => <div><div style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</div><div style={{ fontSize: 11, color: colors.faint, fontFamily: 'monospace' }}>{t.prefix}…</div></div> },
    { key: 'scopes', header: 'Permisos', render: (t) => <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{t.scopes.map((s) => <span key={s} title={SCOPES[s]}><Badge tone="violet">{s}</Badge></span>)}</div> },
    { key: 'last', header: 'Último uso', nowrap: true, render: (t) => <span style={{ fontSize: 12, color: colors.muted }} title={t.lastUsedIp ?? undefined}>{timeAgo(t.lastUsedAt)}</span> },
    { key: 'expires', header: 'Vence', nowrap: true, render: (t) => <span style={{ fontSize: 12, color: colors.muted }}>{new Date(t.expiresAt).toLocaleDateString('es-CO')}</span> },
    { key: 'req', header: 'Requests', align: 'right', render: (t) => t.requests },
    { key: 'status', header: 'Estado', render: (t) => <Badge tone={TOKEN_STATUS[t.status].tone}>{TOKEN_STATUS[t.status].label}</Badge> },
    {
      key: 'revoke', header: '', align: 'right',
      render: (t) => (t.status === 'active' || t.status === 'expiring') ? (
        <button onClick={() => revoke(t)} disabled={pending} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #fc8181', background: '#fff', color: '#c53030', fontSize: 12, fontWeight: 600, cursor: pending ? 'default' : 'pointer' }}>Revocar</button>
      ) : null,
    },
  ]

  const columns: Column<ApiPersonDTO>[] = [
    { key: 'tokens', header: 'Tokens', render: (p) => `${p.activeTokens} ${p.activeTokens === 1 ? 'vigente' : 'vigentes'}` },
    { key: 'last', header: 'Último uso', nowrap: true, render: (p) => <span style={{ color: colors.muted }}>{timeAgo(p.lastUsedAt)}</span> },
    { key: 'req', header: 'Requests', align: 'right', render: (p) => p.requests },
  ]

  return (
    <div style={{ marginBottom: 22 }}>
      <SectionHeader title="Personas con tokens" description="Una fila por dueño de token. Despliega una fila para ver sus tokens, sus permisos y revocarlos." />
      {message && <div role="alert" style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: '#fee2e2', color: '#991b1b', fontSize: 13 }}>{message}</div>}
      <PeopleTable
        rows={overview.rows}
        columns={columns}
        toggle={{ label: 'Incluir personas sin token vigente', keep: (p) => p.activeTokens > 0 }}
        renderDetail={(p) => <SimpleTable columns={subColumns} rows={p.tokens} getKey={(t) => t.id} />}
        empty="No hay personas con token vigente."
      />
    </div>
  )
}

function ActivitySection({ period }: { period: number }) {
  const [q, setQ] = useState('')
  const [result, setResult] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const [data, setData] = useState<ApiActivityPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dq = useDebounced(q)

  useEffect(() => {
    let alive = true
    getApiActivityPage({ q: dq, result, days: period, page, pageSize })
      .then((r) => { if (alive) { setData(r); setError(null) } })
      .catch(() => { if (alive) setError('No se pudo cargar la actividad.') })
    return () => { alive = false }
  }, [dq, result, period, page, pageSize])

  const columns: Column<ApiActivityPage['rows'][number]>[] = [
    { key: 'date', header: 'Fecha', nowrap: true, render: (r) => <span style={{ fontSize: 12, color: colors.muted }} title={new Date(r.timestamp).toLocaleString('es-CO')}>{new Date(r.timestamp).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</span> },
    { key: 'person', header: 'Persona', render: (r) => <PersonCell name={r.ownerName} email={r.ownerEmail} image={r.ownerImage} /> },
    { key: 'token', header: 'Token', render: (r) => <div><div style={{ fontSize: 13 }}>{r.tokenName}</div><div style={{ fontSize: 11, color: colors.faint, fontFamily: 'monospace' }}>{r.tokenPrefix}…</div></div> },
    { key: 'req', header: 'Request', render: (r) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}><b>{r.method}</b> {r.path}</span> },
    { key: 'ip', header: 'Origen', render: (r) => <span style={{ fontSize: 11, color: colors.faint }} title={r.userAgent ?? undefined}>{r.ip ?? '—'}</span> },
    { key: 'result', header: 'Resultado', render: (r) => <span title={`${r.durationMs} ms`}><Badge tone={RESULT_TONE[r.result]}>{r.status} · {RESULT_LABELS[r.result]}</Badge></span> },
  ]
  const p = data ?? { rows: [], page: 1, pageCount: 1, total: 0, from: 0, to: 0, pageSize }

  return (
    <div>
      <SectionHeader title="Actividad (requests)" description="Cada request autenticado con token: quién, con qué token, qué ruta y cómo terminó. Incluye los rechazados (401, 403 y 429)." />
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '14px 16px', borderBottom: `1px solid ${colors.lineSoft}` }}>
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Persona o token…" width={240} />
          <FilterSelect label="Filtrar por resultado" value={result} onChange={(v) => { setResult(v); setPage(1) }} options={[{ value: '', label: 'Todos los resultados' }, ...Object.entries(RESULT_LABELS).map(([value, label]) => ({ value, label }))]} />
        </div>
        {error && <div style={{ padding: 16, color: '#991b1b', fontSize: 13 }}>{error}</div>}
        {!data && !error ? <div style={{ padding: 40, textAlign: 'center', color: colors.faint, fontSize: 13 }}>Cargando…</div> : (
          <SimpleTable columns={columns} rows={p.rows} getKey={(r) => r.id} empty={q || result ? 'Nada coincide con los filtros.' : 'Sin requests en el período.'} />
        )}
        <Pagination page={p.page} pageCount={p.pageCount} total={p.total} from={p.from} to={p.to} pageSize={p.pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1) }} />
      </div>
    </div>
  )
}
