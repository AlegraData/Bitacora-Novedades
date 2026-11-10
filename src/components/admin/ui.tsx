'use client'

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { PAGE_SIZES, DEFAULT_PAGE_SIZE, matchesQuery, paginate, pageWindow, type PageSize } from '@/lib/admin/table'

// Kit visual del panel de administración: tarjetas, métricas, tabla con buscador y paginación, barras.
// Paleta de la app: navy #1e2a3a, verde #00C4A0, grises slate.

export const colors = {
  navy: '#1e2a3a',
  teal: '#00C4A0',
  tealDark: '#00A888',
  tealSoft: '#E0F7F4',
  text: '#1a202c',
  muted: '#718096',
  faint: '#a0aec0',
  line: '#e2e8f0',
  lineSoft: '#f0f4f8',
  bg: '#f8fafc',
} as const

export const card: CSSProperties = { background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: `1px solid ${colors.lineSoft}` }

export type Tone = 'green' | 'blue' | 'amber' | 'red' | 'gray' | 'violet'
const TONES: Record<Tone, { bg: string; color: string; border: string }> = {
  green: { bg: '#dcfce7', color: '#166534', border: '#86efac' },
  blue: { bg: '#dbeafe', color: '#1e3a8a', border: '#93c5fd' },
  amber: { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
  red: { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
  gray: { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' },
  violet: { bg: '#ede9fe', color: '#5b21b6', border: '#c4b5fd' },
}

export function Badge({ tone = 'gray', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  const t = TONES[tone]
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: t.bg, color: t.color, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

export function Avatar({ name, image, size = 32 }: { name: string; image?: string | null; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: colors.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 600, color: '#fff', overflow: 'hidden', flexShrink: 0 }}>
      {image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={image} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : (name || '?').charAt(0).toUpperCase()}
    </div>
  )
}

export function PersonCell({ name, email, image }: { name?: string | null; email: string; image?: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <Avatar name={name ?? email} image={image} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name ?? email}</div>
        {name && <div style={{ fontSize: 11, color: colors.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>}
      </div>
    </div>
  )
}

export function SectionHeader({ title, description, right }: { title: string; description?: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
      <div style={{ maxWidth: 760 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: colors.text, margin: 0 }}>{title}</h2>
        {description && <p style={{ fontSize: 13, color: colors.muted, margin: '4px 0 0', lineHeight: 1.5 }}>{description}</p>}
      </div>
      {right}
    </div>
  )
}

export function StatCard({ label, value, hint, icon, tone = 'gray' }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: Tone }) {
  return (
    <div style={{ ...card, padding: '16px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12.5, color: colors.muted }}>{label}</span>
        {icon && <span style={{ color: TONES[tone].color, display: 'inline-flex' }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: colors.text, marginTop: 6, lineHeight: 1.1 }}>{value}</div>
      {hint && <div style={{ fontSize: 11.5, color: colors.faint, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 16 }}>{children}</div>
}

/** Barras horizontales (p. ej. «Conexiones por agente»). */
export function BarList({ items, empty = 'Sin datos todavía.' }: { items: { label: string; value: number; color?: string }[]; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (items.length === 0) return <div style={{ fontSize: 13, color: colors.faint }}>{empty}</div>
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {items.map((i) => (
        <div key={i.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: colors.text, marginBottom: 4 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>{i.label}</span>
            <span style={{ color: colors.muted }}>{i.value}</span>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: colors.lineSoft }}>
            <div style={{ width: `${Math.max(3, (i.value / max) * 100)}%`, height: '100%', borderRadius: 999, background: i.color ?? colors.teal }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Columnas por día («Llamadas por día»). */
export function DayBars({ days }: { days: { label: string; value: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.value))
  if (days.length === 0 || days.every((d) => d.value === 0)) return <div style={{ fontSize: 13, color: colors.faint }}>Sin llamadas en el período.</div>
  return (
    <div role="img" aria-label="Llamadas por día" style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 130 }}>
      {days.map((d) => (
        <div key={d.label} title={`${d.label}: ${d.value}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 4 }}>
          <div style={{ width: '100%', maxWidth: 46, height: `${Math.max(d.value ? 4 : 1, (d.value / max) * 100)}%`, background: d.value ? colors.teal : colors.line, borderRadius: '4px 4px 0 0' }} />
          <span style={{ fontSize: 10, color: colors.faint }}>{d.label}</span>
        </div>
      ))}
    </div>
  )
}

const inputBase: CSSProperties = { padding: '8px 12px', border: `1px solid ${colors.line}`, borderRadius: 8, fontSize: 13, background: '#fff', color: colors.text, outline: 'none' }

export function SearchBox({ value, onChange, placeholder = 'Buscar…', width = 280 }: { value: string; onChange: (v: string) => void; placeholder?: string; width?: number }) {
  return (
    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <Search size={15} style={{ position: 'absolute', left: 10, color: colors.faint, pointerEvents: 'none' }} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{ ...inputBase, paddingLeft: 32, width }}
      />
    </label>
  )
}

export function FilterSelect({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} style={{ ...inputBase, cursor: 'pointer' }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

const pageBtn = (disabled: boolean, active = false): CSSProperties => ({
  minWidth: 30, height: 30, padding: '0 8px', borderRadius: 8, border: `1px solid ${active ? colors.navy : colors.line}`,
  background: active ? colors.navy : '#fff', color: active ? '#fff' : disabled ? colors.faint : colors.text,
  fontSize: 12.5, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
})

/** Pie de tabla: «1–10 de 86», filas por página (10/20/50) y navegación. Sirve igual para paginación en cliente o en servidor. */
export function Pagination({ page, pageCount, total, from, to, pageSize, onPage, onPageSize }: {
  page: number; pageCount: number; total: number; from: number; to: number; pageSize: PageSize
  onPage: (p: number) => void; onPageSize: (s: PageSize) => void
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderTop: `1px solid ${colors.lineSoft}`, fontSize: 12.5, color: colors.muted }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>{total === 0 ? 'Sin resultados' : `${from}–${to} de ${total}`}</span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Filas
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value) as PageSize)} aria-label="Filas por página" style={{ ...inputBase, padding: '4px 8px', fontSize: 12.5, cursor: 'pointer' }}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <nav aria-label="Paginación" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button onClick={() => onPage(1)} disabled={page <= 1} aria-label="Primera página" style={pageBtn(page <= 1)}><ChevronsLeft size={14} /></button>
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Página anterior" style={pageBtn(page <= 1)}><ChevronLeft size={14} /></button>
        {pageWindow(page, pageCount).map((p, i) =>
          p === '…'
            ? <span key={`gap${i}`} style={{ padding: '0 4px', color: colors.faint }}>…</span>
            : <button key={p} onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined} style={pageBtn(false, p === page)}>{p}</button>
        )}
        <button onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria-label="Página siguiente" style={pageBtn(page >= pageCount)}><ChevronRight size={14} /></button>
        <button onClick={() => onPage(pageCount)} disabled={page >= pageCount} aria-label="Última página" style={pageBtn(page >= pageCount)}><ChevronsRight size={14} /></button>
      </nav>
    </div>
  )
}

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  align?: 'left' | 'center' | 'right'
  width?: number | string
  nowrap?: boolean
}

export const th: CSSProperties = { padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: colors.faint, background: colors.navy, whiteSpace: 'nowrap' }
export const td: CSSProperties = { padding: '12px 16px', fontSize: 13, color: colors.text, verticalAlign: 'middle' }

/** Cuerpo de tabla genérico (encabezado + filas); lo usan DataTable y las tablas paginadas en servidor. */
export function SimpleTable<T>({ columns, rows, getKey, empty = 'Sin resultados.', onRowClick }: {
  columns: Column<T>[]; rows: T[]; getKey: (row: T) => string; empty?: ReactNode; onRowClick?: (row: T) => void
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key} style={{ ...th, textAlign: c.align ?? 'left', width: c.width }}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={getKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} style={{ borderBottom: `1px solid ${colors.lineSoft}`, cursor: onRowClick ? 'pointer' : 'default' }}>
              {columns.map((c) => <td key={c.key} style={{ ...td, textAlign: c.align ?? 'left', whiteSpace: c.nowrap ? 'nowrap' : undefined }}>{c.render(r)}</td>)}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} style={{ padding: 40, textAlign: 'center', color: colors.faint, fontSize: 13 }}>{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Tabla con buscador y paginación en el cliente (para listas pequeñas: usuarios, campos…).
 * `searchText` devuelve los textos de la fila sobre los que se busca.
 */
export function DataTable<T>({ columns, rows, getKey, searchText, searchPlaceholder = 'Buscar…', empty, toolbar, initialPageSize = DEFAULT_PAGE_SIZE, description }: {
  columns: Column<T>[]
  rows: T[]
  getKey: (row: T) => string
  searchText?: (row: T) => unknown[]
  searchPlaceholder?: string
  empty?: ReactNode
  /** Filtros extra (selects…) que se muestran junto al buscador. */
  toolbar?: ReactNode
  initialPageSize?: PageSize
  description?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(initialPageSize)

  const filtered = useMemo(() => (searchText && query.trim() ? rows.filter((r) => matchesQuery(searchText(r), query)) : rows), [rows, query, searchText])
  const p = paginate(filtered, page, pageSize)

  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '14px 16px', borderBottom: `1px solid ${colors.lineSoft}` }}>
        {searchText && <SearchBox value={query} onChange={(v) => { setQuery(v); setPage(1) }} placeholder={searchPlaceholder} />}
        {toolbar}
        {description && <span style={{ fontSize: 12.5, color: colors.muted, marginLeft: 'auto' }}>{description}</span>}
      </div>
      <SimpleTable columns={columns} rows={p.rows} getKey={getKey} empty={query ? 'Nada coincide con la búsqueda.' : empty} />
      <Pagination page={p.page} pageCount={p.pageCount} total={p.total} from={p.from} to={p.to} pageSize={p.pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1) }} />
    </div>
  )
}
