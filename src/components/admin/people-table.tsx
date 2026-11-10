'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { DEFAULT_PAGE_SIZE, matchesQuery, paginate, type PageSize } from '@/lib/admin/table'
import { Pagination, PersonCell, SearchBox, card, colors, th, td, type Column } from './ui'

export interface PersonBase {
  email: string
  name: string | null
  image: string | null
}

/**
 * Una fila por persona con buscador, paginación (10/20/50) y detalle desplegable.
 * `columns` son las columnas que siguen a «Persona»; `renderDetail` pinta lo que se ve al desplegar.
 */
export function PeopleTable<T extends PersonBase>({ rows, columns, renderDetail, toggle, searchPlaceholder = 'Buscar por nombre o correo…', empty }: {
  rows: T[]
  columns: Column<T>[]
  renderDetail: (row: T) => ReactNode
  /** Casilla opcional que amplía la lista (p. ej. «Incluir personas sin conexión vigente»). Sin marcar se aplica `keep`. */
  toggle?: { label: string; keep: (row: T) => boolean }
  searchPlaceholder?: string
  empty: string
}) {
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const [open, setOpen] = useState<string | null>(null)

  const filtered = useMemo(
    () => rows.filter((r) => (!toggle || all || toggle.keep(r)) && matchesQuery([r.name, r.email], q)),
    [rows, toggle, all, q]
  )
  const p = paginate(filtered, page, pageSize)
  const span = columns.length + 2

  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', padding: '14px 16px', borderBottom: `1px solid ${colors.lineSoft}` }}>
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder={searchPlaceholder} />
        {toggle && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: colors.muted, cursor: 'pointer' }}>
            <input type="checkbox" checked={all} onChange={(e) => { setAll(e.target.checked); setPage(1) }} style={{ accentColor: colors.teal }} />
            {toggle.label}
          </label>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 28 }} />
              <th style={th}>Persona</th>
              {columns.map((c) => <th key={c.key} style={{ ...th, textAlign: c.align ?? 'left' }}>{c.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <Fragment key={r.email}>
                <tr onClick={() => setOpen(open === r.email ? null : r.email)} style={{ borderBottom: `1px solid ${colors.lineSoft}`, cursor: 'pointer' }}>
                  <td style={td}>{open === r.email ? <ChevronDown size={15} color={colors.faint} /> : <ChevronRight size={15} color={colors.faint} />}</td>
                  <td style={td}><PersonCell name={r.name} email={r.email} image={r.image} /></td>
                  {columns.map((c) => <td key={c.key} style={{ ...td, textAlign: c.align ?? 'left', whiteSpace: c.nowrap ? 'nowrap' : undefined }}>{c.render(r)}</td>)}
                </tr>
                {open === r.email && (
                  <tr>
                    <td colSpan={span} style={{ padding: 0, background: colors.bg }}>
                      <div style={{ padding: '4px 16px 14px 44px' }}>{renderDetail(r)}</div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {p.rows.length === 0 && <tr><td colSpan={span} style={{ padding: 40, textAlign: 'center', color: colors.faint, fontSize: 13 }}>{q ? 'Nada coincide con la búsqueda.' : empty}</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={p.page} pageCount={p.pageCount} total={p.total} from={p.from} to={p.to} pageSize={p.pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1) }} />
    </div>
  )
}
