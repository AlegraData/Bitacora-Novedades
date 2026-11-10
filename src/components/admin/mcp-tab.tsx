'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Activity, Plug, ShieldAlert, Users } from 'lucide-react'
import type { McpOverviewDTO, McpActivityPage, PersonDTO, ConnectionDTO } from '@/lib/admin/mcp-dashboard'
import { DEFAULT_PAGE_SIZE, type PageSize } from '@/lib/admin/table'
import { toolLabel, RESULT_LABELS, timeAgo } from '@/lib/admin/labels'
import { getMcpOverviewAction, getMcpActivityPage } from '@/lib/actions/admin-data'
import { revokeMcpSession } from '@/lib/actions/mcp-sessions'
import {
  Badge, BarList, DayBars, FilterSelect, PersonCell, Pagination, SearchBox, SectionHeader, SimpleTable, StatCard, StatGrid,
  card, colors, useDebounced, type Column, type Tone,
} from './ui'
import { PeopleTable } from './people-table'

const AGENT_COLORS: Record<string, string> = { Claude: '#e07a5f', 'Claude Code': '#c1442e', opencode: '#3b82f6', 'Otro agente': '#64748b' }
const STATUS_TONE: Record<string, Tone> = { ok: 'green', denied: 'amber', error: 'red' }
const CONN_STATUS: Record<ConnectionDTO['status'], { label: string; tone: Tone }> = {
  active: { label: 'Vigente', tone: 'green' }, expiring: { label: 'Expira pronto', tone: 'amber' }, expired: { label: 'Expirada', tone: 'gray' }, revoked: { label: 'Revocada', tone: 'red' },
}
const PERIOD_OPTIONS = [{ value: '7', label: 'Últimos 7 días' }, { value: '30', label: 'Últimos 30 días' }, { value: '90', label: 'Últimos 90 días' }]

export function McpTab() {
  const [period, setPeriod] = useState('7')
  const [overview, setOverview] = useState<McpOverviewDTO | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    getMcpOverviewAction(Number(period)).then((o) => { setOverview(o); setError(null) }).catch(() => setError('No se pudo cargar el dashboard de MCP.'))
  }, [period])
  useEffect(load, [load])

  if (error) return <div style={{ ...card, padding: 20, color: '#991b1b' }}>{error}</div>
  if (!overview) return <div style={{ ...card, padding: 40, textAlign: 'center', color: colors.faint }}>Cargando…</div>

  const failed = overview.results.denied + overview.results.error
  return (
    <div>
      <SectionHeader
        title="Conexiones MCP"
        description="Agentes de IA (Claude, Claude Code, opencode…) conectados a la Bitácora por MCP. Solo se registra qué herramienta se usó y sobre qué novedad, nunca su contenido. El tipo de agente lo informa el propio cliente: es informativo, no verificado."
        right={<FilterSelect label="Período" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />}
      />
      {!overview.trackingSince && (
        <div style={{ ...card, padding: '10px 16px', marginBottom: 14, fontSize: 12.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d' }}>
          Todavía no hay llamadas registradas: el detalle de actividad empieza a llenarse desde el despliegue de este dashboard. Las conexiones sí se ven completas.
        </div>
      )}
      <StatGrid>
        <StatCard label="Personas conectadas" value={overview.people} icon={<Users size={18} />} tone="blue" />
        <StatCard label="Conexiones vigentes" value={overview.activeConnections} icon={<Plug size={18} />} tone="green" />
        <StatCard label={`Llamadas (${overview.period} d)`} value={overview.calls} icon={<Activity size={18} />} tone="violet" hint={overview.trackingSince ? `Registro desde ${new Date(overview.trackingSince).toLocaleDateString('es-CO')}` : undefined} />
        <StatCard label="Denegadas o con error" value={failed} icon={<ShieldAlert size={18} />} tone={failed ? 'amber' : 'gray'} hint={`${overview.results.denied} denegadas · ${overview.results.error} con error`} />
      </StatGrid>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 20 }}>
        <div style={{ ...card, padding: 18 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px' }}>Conexiones por agente</h3>
          <BarList items={overview.byAgent.map((a) => ({ label: a.agent, value: a.count, color: AGENT_COLORS[a.agent] }))} empty="No hay conexiones vigentes." />
        </div>
        <div style={{ ...card, padding: 18 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px' }}>Resultado de las llamadas</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <Badge tone="green">Correcta · {overview.results.ok}</Badge>
            <Badge tone="amber">Denegada · {overview.results.denied}</Badge>
            <Badge tone="red">Error · {overview.results.error}</Badge>
          </div>
          <p style={{ fontSize: 12, color: colors.muted, margin: 0, lineHeight: 1.5 }}>
            Las denegadas son intentos bloqueados (sin el rol o permiso necesario). Un pico repentino merece revisión.
          </p>
        </div>
        <div style={{ ...card, padding: 18 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px' }}>Llamadas por día</h3>
          <DayBars days={overview.perDay.map((d) => ({ label: d.label, value: d.value }))} />
        </div>
      </div>

      <PeopleSection overview={overview} onChanged={load} />
      <ActivitySection period={overview.period} />
    </div>
  )
}

function PeopleSection({ overview, onChanged }: { overview: McpOverviewDTO; onChanged: () => void }) {
  const [pending, start] = useTransition()

  function revoke(id: string) {
    if (!window.confirm('¿Revocar esta conexión? La persona pierde el acceso de inmediato.')) return
    start(async () => { await revokeMcpSession(id); onChanged() })
  }

  const subColumns: Column<ConnectionDTO>[] = [
    { key: 'agent', header: 'Agente', render: (c) => <div><div style={{ fontSize: 13, fontWeight: 500 }}>{c.agent}</div><div style={{ fontSize: 11, color: colors.faint }}>{c.clientName ?? 'Cliente desconocido'}</div></div> },
    { key: 'created', header: 'Conectada', nowrap: true, render: (c) => <span style={{ fontSize: 12, color: colors.muted }}>{new Date(c.createdAt).toLocaleString('es-CO')}</span> },
    { key: 'last', header: 'Último uso', nowrap: true, render: (c) => <span style={{ fontSize: 12, color: colors.muted }}>{timeAgo(c.lastUsedAt)}</span> },
    { key: 'calls', header: 'Llamadas', align: 'right', render: (c) => c.calls },
    { key: 'status', header: 'Estado', render: (c) => <Badge tone={CONN_STATUS[c.status].tone}>{CONN_STATUS[c.status].label}</Badge> },
    {
      key: 'revoke', header: '', align: 'right',
      render: (c) => (c.status === 'active' || c.status === 'expiring') ? (
        <button onClick={() => revoke(c.id)} disabled={pending} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #fc8181', background: '#fff', color: '#c53030', fontSize: 12, fontWeight: 600, cursor: pending ? 'default' : 'pointer' }}>Revocar</button>
      ) : null,
    },
  ]

  const columns: Column<PersonDTO>[] = [
    {
      key: 'agents', header: 'Agentes',
      render: (p) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {p.agents.length === 0 ? <span style={{ color: colors.faint }}>—</span> : p.agents.map((a) => <Badge key={a.agent}>{a.agent}{a.count > 1 ? ` ×${a.count}` : ''}</Badge>)}
        </div>
      ),
    },
    { key: 'conns', header: 'Conexiones', render: (p) => `${p.activeConnections} ${p.activeConnections === 1 ? 'vigente' : 'vigentes'}` },
    { key: 'last', header: 'Último uso', nowrap: true, render: (p) => <span style={{ color: colors.muted }}>{timeAgo(p.lastUsedAt)}</span> },
    { key: 'calls', header: 'Llamadas', align: 'right', render: (p) => p.calls },
  ]

  return (
    <div style={{ marginBottom: 22 }}>
      <SectionHeader title="Personas conectadas" description="Una fila por persona (por correo), aunque tenga varias conexiones. Despliega una fila para ver y gestionar cada una." />
      <PeopleTable
        rows={overview.rows}
        columns={columns}
        toggle={{ label: 'Incluir personas sin conexión vigente', keep: (p) => p.activeConnections > 0 }}
        renderDetail={(p) => <SimpleTable columns={subColumns} rows={p.connections} getKey={(c) => c.id} />}
        empty="No hay personas con conexión vigente."
      />
    </div>
  )
}

function ActivitySection({ period }: { period: number }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [tool, setTool] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const [data, setData] = useState<McpActivityPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dq = useDebounced(q)

  useEffect(() => {
    let alive = true
    getMcpActivityPage({ q: dq, status, tool, days: period, page, pageSize })
      .then((r) => { if (alive) { setData(r); setError(null) } })
      .catch(() => { if (alive) setError('No se pudo cargar la actividad.') })
    return () => { alive = false }
  }, [dq, status, tool, period, page, pageSize])

  const columns: Column<McpActivityPage['rows'][number]>[] = [
    { key: 'date', header: 'Fecha', nowrap: true, render: (r) => <span style={{ fontSize: 12, color: colors.muted }} title={new Date(r.timestamp).toLocaleString('es-CO')}>{new Date(r.timestamp).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</span> },
    { key: 'person', header: 'Persona', render: (r) => <PersonCell name={r.userName} email={r.userEmail} image={r.userImage} /> },
    { key: 'agent', header: 'Agente', render: (r) => <Badge>{r.agent}</Badge> },
    { key: 'tool', header: 'Herramienta', render: (r) => toolLabel(r.tool) },
    {
      key: 'record', header: 'Novedad',
      render: (r) => r.recordId ? <a href={`/app?record=${r.recordId}`} style={{ color: colors.tealDark, fontSize: 13 }}>{r.recordTitle ?? r.recordId}</a> : <span style={{ color: colors.faint }}>—</span>,
    },
    { key: 'status', header: 'Resultado', render: (r) => <span title={r.errorMessage ?? `${r.durationMs} ms`}><Badge tone={STATUS_TONE[r.status] ?? 'gray'}>{RESULT_LABELS[r.status] ?? r.status}</Badge></span> },
  ]
  const p = data ?? { rows: [], page: 1, pageCount: 1, total: 0, from: 0, to: 0, pageSize, tools: [] }

  return (
    <div>
      <SectionHeader title="Actividad (consultas)" description="Cada llamada a una herramienta: quién, con qué agente y sobre qué novedad. Nunca se guarda el contenido." />
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '14px 16px', borderBottom: `1px solid ${colors.lineSoft}` }}>
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Persona…" width={220} />
          <FilterSelect label="Filtrar por resultado" value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[{ value: '', label: 'Todos los resultados' }, ...Object.entries(RESULT_LABELS).map(([value, label]) => ({ value, label }))]} />
          <FilterSelect label="Filtrar por herramienta" value={tool} onChange={(v) => { setTool(v); setPage(1) }} options={[{ value: '', label: 'Todas las herramientas' }, ...p.tools.map((t) => ({ value: t, label: toolLabel(t) }))]} />
        </div>
        {error && <div style={{ padding: 16, color: '#991b1b', fontSize: 13 }}>{error}</div>}
        {!data && !error ? <div style={{ padding: 40, textAlign: 'center', color: colors.faint, fontSize: 13 }}>Cargando…</div> : (
          <SimpleTable columns={columns} rows={p.rows} getKey={(r) => r.id} empty={q || status || tool ? 'Nada coincide con los filtros.' : 'Sin llamadas registradas en el período.'} />
        )}
        <Pagination page={p.page} pageCount={p.pageCount} total={p.total} from={p.from} to={p.to} pageSize={p.pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1) }} />
      </div>
    </div>
  )
}
