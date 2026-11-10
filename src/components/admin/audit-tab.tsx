'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AuditPageDTO } from '@/lib/admin/audit'
import { DEFAULT_PAGE_SIZE, type PageSize } from '@/lib/admin/table'
import { getAuditPage } from '@/lib/actions/admin-data'
import { Badge, FilterSelect, Pagination, SearchBox, SectionHeader, SimpleTable, card, colors, type Column, type Tone } from './ui'

type Row = AuditPageDTO['rows'][number]

function actionTone(a: string): Tone {
  if (a.includes('DELETED') || a.includes('REVOKED') || a.includes('FAILED')) return 'red'
  if (a.includes('CREATED') || a.includes('SENT') || a.includes('NOTIFIED')) return 'green'
  if (a.startsWith('MCP_')) return 'violet'
  if (a.includes('UPDATED') || a.includes('RESEND')) return 'blue'
  return 'gray'
}

const VIA_LABEL: Record<string, string> = { web: 'App web', mcp: 'MCP', api: 'API' }

/** Espera a que termine de escribir antes de consultar. */
function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function AuditTab() {
  const [q, setQ] = useState('')
  const [action, setAction] = useState('')
  const [via, setVia] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const [data, setData] = useState<AuditPageDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const dq = useDebounced(q)

  useEffect(() => {
    let alive = true
    getAuditPage({ q: dq, action, via, page, pageSize })
      .then((r) => { if (alive) { setData(r); setError(null) } })
      .catch(() => { if (alive) setError('No se pudo cargar la auditoría.') })
    return () => { alive = false }
  }, [dq, action, via, page, pageSize])

  const columns: Column<Row>[] = [
    {
      key: 'expand', header: '', width: 28,
      render: (r) => r.details ? (open === r.id ? <ChevronDown size={14} color={colors.faint} /> : <ChevronRight size={14} color={colors.faint} />) : null,
    },
    { key: 'date', header: 'Fecha', nowrap: true, render: (r) => <span style={{ fontSize: 12, color: colors.muted }}>{new Date(r.timestamp).toLocaleString('es-CO')}</span> },
    {
      key: 'user', header: 'Usuario',
      render: (r) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{r.userName}</div>
          <div style={{ fontSize: 11, color: colors.faint }}>{r.userEmail}</div>
        </div>
      ),
    },
    { key: 'action', header: 'Acción', render: (r) => <Badge tone={actionTone(r.action)}>{r.action}</Badge> },
    { key: 'via', header: 'Origen', render: (r) => <span style={{ fontSize: 12, color: colors.muted }}>{VIA_LABEL[r.via] ?? r.via}{r.tool ? ` · ${r.tool}` : ''}</span> },
    { key: 'record', header: 'Registro', render: (r) => r.recordId ? <a href={`/app?record=${r.recordId}`} style={{ fontSize: 11, color: colors.tealDark, fontFamily: 'monospace' }}>{r.recordId}</a> : <span style={{ color: colors.faint }}>—</span> },
  ]

  const p = data ?? { rows: [], page: 1, pageCount: 1, total: 0, from: 0, to: 0, pageSize, actions: [] }

  return (
    <div>
      <SectionHeader
        title="Auditoría"
        description="Quién hizo qué y cuándo: cambios en novedades, envíos de correo, reglas de comunicación y consultas por MCP. Haz clic en una fila para ver el detalle."
      />
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '14px 16px', borderBottom: `1px solid ${colors.lineSoft}` }}>
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Buscar por usuario, acción o ID de registro…" width={340} />
          <FilterSelect label="Filtrar por acción" value={action} onChange={(v) => { setAction(v); setPage(1) }} options={[{ value: '', label: 'Todas las acciones' }, ...p.actions.map((a) => ({ value: a, label: a }))]} />
          <FilterSelect label="Filtrar por origen" value={via} onChange={(v) => { setVia(v); setPage(1) }} options={[{ value: '', label: 'Todos los orígenes' }, { value: 'mcp', label: 'MCP' }, { value: 'api', label: 'API' }]} />
        </div>
        {error && <div style={{ padding: 16, color: '#991b1b', fontSize: 13 }}>{error}</div>}
        {!data && !error ? (
          <div style={{ padding: 40, textAlign: 'center', color: colors.faint, fontSize: 13 }}>Cargando…</div>
        ) : (
          <SimpleTable
            columns={columns}
            rows={p.rows}
            getKey={(r) => r.id}
            empty={q || action || via ? 'Nada coincide con los filtros.' : 'Sin registros de auditoría.'}
            onRowClick={(r) => r.details && setOpen(open === r.id ? null : r.id)}
          />
        )}
        {open && data?.rows.find((r) => r.id === open)?.details && (
          <pre style={{ margin: 0, padding: '12px 16px', background: colors.bg, borderTop: `1px solid ${colors.lineSoft}`, fontSize: 11.5, color: '#334155', overflowX: 'auto', maxHeight: 240 }}>
            {JSON.stringify(data.rows.find((r) => r.id === open)!.details, null, 2)}
          </pre>
        )}
        <Pagination page={p.page} pageCount={p.pageCount} total={p.total} from={p.from} to={p.to} pageSize={p.pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1) }} />
      </div>
    </div>
  )
}

