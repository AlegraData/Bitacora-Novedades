'use client'

import { useState, useTransition, useCallback, useEffect, useMemo, useRef, useLayoutEffect } from 'react'
import type { Field, BitacoraRecord, Tag, FilterState, Role, View, SortConfig } from '@/types'
import { saveRecord, deleteRecord } from '@/lib/actions/records'
import { saveField, deleteField, reorderFields } from '@/lib/actions/fields'
import { saveTag, deleteTag } from '@/lib/actions/tags'
import { triggerButtonWebhook } from '@/lib/actions/webhook'
import { saveView, deleteView } from '@/lib/actions/views'
import { RecordEditor } from './record-editor'
import { RecordDetail } from './record-detail'
import { FieldEditor } from './field-editor'
import { Chatbot } from './chatbot'
import { ViewTabs } from './view-tabs'

function FieldTypeIcon({ type }: { type: string }) {
  const st = { display: 'inline-flex' as const, alignItems: 'center' as const, justifyContent: 'center' as const, flexShrink: 0 }
  const c = '#94a3b8'
  switch (type) {
    case 'text': return <span style={st}><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 4.5h10M2 7.5h7M2 10.5h8.5" stroke={c} strokeWidth="1.6" strokeLinecap="round"/></svg></span>
    case 'textarea': return <span style={st}><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 3.5h10M2 6.5h10M2 9.5h6.5" stroke={c} strokeWidth="1.6" strokeLinecap="round"/><path d="M10 10.5l2 2-2 0" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    case 'number': return <span style={st}><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M5.5 2l-1.5 10M10 2l-1.5 10M2 5.5h10M2 8.5h10" stroke={c} strokeWidth="1.5" strokeLinecap="round"/></svg></span>
    case 'date': return <span style={st}><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke={c} strokeWidth="1.4"/><path d="M1.5 6h11" stroke={c} strokeWidth="1.4"/><path d="M4.5 1v3M9.5 1v3" stroke={c} strokeWidth="1.5" strokeLinecap="round"/><circle cx="4.5" cy="9" r="0.9" fill={c}/><circle cx="7" cy="9" r="0.9" fill={c}/><circle cx="9.5" cy="9" r="0.9" fill={c}/></svg></span>
    case 'select': return <span style={st}><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke={c} strokeWidth="1.4"/><path d="M4.5 7l2.5 2.5 2.5-2.5" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    case 'multiselect': return <span style={st}><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 4.5h5M2 9.5h5" stroke={c} strokeWidth="1.5" strokeLinecap="round"/><rect x="9" y="2.5" width="3.5" height="3.5" rx="0.8" stroke={c} strokeWidth="1.3"/><rect x="9" y="7.5" width="3.5" height="3.5" rx="0.8" stroke={c} strokeWidth="1.3"/><path d="M9.5 4.2l0.8 0.8 1.2-1.2" stroke={c} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    case 'person': return <span style={st}><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="4.5" r="2.5" stroke={c} strokeWidth="1.4"/><path d="M2 12.5c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke={c} strokeWidth="1.4" strokeLinecap="round"/></svg></span>
    case 'button': return <span style={st}><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><polygon points="3,1 13,7 3,13" stroke={c} strokeWidth="1.4" strokeLinejoin="round" fill="none"/></svg></span>
    case 'url': return <span style={st}><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M5.5 8.5l3-3" stroke={c} strokeWidth="1.4" strokeLinecap="round"/><path d="M3.5 9.5a2.5 2.5 0 010-3.5l1.5-1.5" stroke={c} strokeWidth="1.4" strokeLinecap="round"/><path d="M9 4.5l1.5-1.5a2.5 2.5 0 010 3.5l-1.5 1.5" stroke={c} strokeWidth="1.4" strokeLinecap="round"/></svg></span>
    case 'checkbox': return <span style={st}><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke={c} strokeWidth="1.4"/><path d="M4 7l2 2 4-4" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    default: return <span style={st}><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 4.5h10M2 7.5h7M2 10.5h8.5" stroke={c} strokeWidth="1.6" strokeLinecap="round"/></svg></span>
  }
}

const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#14b8a6','#f97316']

function avatarColor(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xff
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function tagTextColor(hex: string): string {
  const h = hex.replace('#', '').padEnd(6, '0')
  const r = parseInt(h.slice(0, 2), 16) || 0
  const g = parseInt(h.slice(2, 4), 16) || 0
  const b = parseInt(h.slice(4, 6), 16) || 0
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.58 ? '#374151' : '#ffffff'
}

function TitleCell({ record, field, onClick }: { record: BitacoraRecord, field: Field, onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 28, gap: 8 }}
    >
      <span style={{ display: 'block', maxWidth: hovered ? 120 : 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, color: '#1e40af' }}>
        {String(record.data[field.id] ?? '—')}
      </span>
      {hovered && (
        <button
          onClick={onClick}
          style={{
            padding: '4px 8px', background: '#e0e7ff', color: '#4338ca',
            border: '1px solid #c7d2fe', borderRadius: 6, cursor: 'pointer',
            fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap'
          }}
        >
          Ver en ventana lateral
        </button>
      )}
    </div>
  )
}

function TagChip({ tag }: { tag: Tag }) {
  const isNeutral = tag.color === '#e2e8f0' || tag.color === '#f0f4f8'
  const bg = isNeutral ? '#f1f5f9' : tag.color
  const text = isNeutral ? '#475569' : tagTextColor(tag.color)
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 10px',
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.01em',
      background: bg,
      color: text,
      margin: '2px',
      whiteSpace: 'nowrap',
    }}>
      {tag.name}
    </span>
  )
}

function CellValue({
  field,
  value,
  allTags,
}: {
  field: Field
  value: unknown
  allTags: Tag[]
}) {
  if (value === null || value === undefined || value === '') return <span style={{ color: '#a0aec0' }}>—</span>

  const fieldTags = allTags.filter((t) => t.fieldId === field.id)

  switch (field.type) {
    case 'select': {
      const tag = fieldTags.find((t) => t.name === String(value))
      return tag ? <TagChip tag={tag} /> : <span>{String(value)}</span>
    }
    case 'multiselect': {
      const vals = Array.isArray(value) ? value : String(value).split(',').map((v) => v.trim())
      return (
        <span>
          {vals.map((v, i) => {
            const tag = fieldTags.find((t) => t.name === v)
            return tag ? <TagChip key={i} tag={tag} /> : <span key={i} style={{ margin: '1px', fontSize: 12 }}>{v}</span>
          })}
        </span>
      )
    }
    case 'checkbox':
      return (
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 20, borderRadius: 5,
          background: value ? '#00C4A0' : '#e2e8f0',
          color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0,
        }}>
          {value ? '✓' : ''}
        </span>
      )
    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noopener noreferrer"
          style={{
            color: '#0ea5e9', textDecoration: 'none', fontSize: 12,
            display: 'inline-flex', alignItems: 'center', gap: 3,
            maxWidth: 180, overflow: 'hidden',
          }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {String(value).replace(/^https?:\/\//, '').replace(/\/$/, '')}
          </span>
          <span style={{ fontSize: 10, opacity: 0.6, flexShrink: 0 }}>↗</span>
        </a>
      )
    case 'person': {
      const names = Array.isArray(value) ? value : String(value).split(',').map((v) => v.trim())
      return (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {names.map((n, i) => {
            const color = avatarColor(n)
            return (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '2px 8px 2px 3px', borderRadius: 20,
                background: color + '15', fontSize: 12, color: '#374151',
                border: `1px solid ${color}30`,
              }}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: color, display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0,
                }}>
                  {n.charAt(0).toUpperCase()}
                </span>
                {n}
              </span>
            )
          })}
        </span>
      )
    }
    case 'date':
      try {
        const raw = String(value).slice(0, 10)
        const d = new Date(raw + 'T12:00:00')
        return (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            color: '#64748b', fontSize: 12, whiteSpace: 'nowrap',
          }}>
            <span style={{ fontSize: 13 }}>📅</span>
            {d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
          </span>
        )
      } catch {
        return <span style={{ fontSize: 12, color: '#64748b' }}>{String(value)}</span>
      }
    case 'textarea':
      return (
        <span style={{
          display: 'block', whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis', maxWidth: 220, color: '#374151', fontSize: 13,
        }} title={String(value)}>
          {String(value)}
        </span>
      )
    default:
      return (
        <span style={{
          display: 'block', whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis', maxWidth: 220, color: '#374151', fontSize: 13,
        }}>
          {String(value)}
        </span>
      )
  }
}

function pageNavBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32, borderRadius: 6, fontSize: 15, lineHeight: 1,
    background: 'transparent', border: '1px solid #e2e8f0',
    color: disabled ? '#cbd5e1' : '#374151',
    cursor: disabled ? 'default' : 'pointer',
  }
}

function pageNumBtn(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32, borderRadius: 6, fontSize: 13,
    fontWeight: active ? 700 : 400,
    background: active ? '#00C4A0' : 'transparent',
    color: active ? '#fff' : '#374151',
    border: active ? 'none' : '1px solid #e2e8f0',
    cursor: active ? 'default' : 'pointer',
  }
}

function buildPageRange(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '…')[] = [1]
  if (current > 3) pages.push('…')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
  if (current < total - 2) pages.push('…')
  pages.push(total)
  return pages
}

function PaginationBar({
  currentPage, totalPages, pageSize, filteredCount, totalCount, onPageChange, onPageSizeChange,
}: {
  currentPage: number; totalPages: number; pageSize: number
  filteredCount: number; totalCount: number
  onPageChange: (p: number) => void; onPageSizeChange: (s: number) => void
}) {
  const from = filteredCount === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const to = Math.min(currentPage * pageSize, filteredCount)
  const pages = buildPageRange(currentPage, totalPages)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 20px', borderTop: '1px solid #e8edf2',
      background: '#fff', flexShrink: 0, gap: 12,
    }}>
      {/* Info + page size selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#64748b', flexWrap: 'wrap' }}>
        <span>
          {from}–{to} de <strong style={{ color: '#374151' }}>{filteredCount}</strong> registros
          {filteredCount !== totalCount && <span style={{ color: '#94a3b8' }}> (total {totalCount})</span>}
        </span>
        <span style={{ color: '#e2e8f0' }}>│</span>
        <span>Filas por página</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          style={{
            padding: '3px 8px', border: '1px solid #e2e8f0', borderRadius: 6,
            fontSize: 12, color: '#374151', background: '#fff', cursor: 'pointer', outline: 'none',
          }}
        >
          {[10, 25, 50, 100].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Page navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button onClick={() => onPageChange(1)} disabled={currentPage === 1} style={pageNavBtn(currentPage === 1)}>«</button>
        <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} style={pageNavBtn(currentPage === 1)}>‹</button>
        {pages.map((p, i) =>
          p === '…'
            ? <span key={`e${i}`} style={{ padding: '0 4px', color: '#94a3b8', fontSize: 13, userSelect: 'none' }}>…</span>
            : <button key={p} onClick={() => onPageChange(p as number)} style={pageNumBtn(p === currentPage)}>{p}</button>
        )}
        <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} style={pageNavBtn(currentPage === totalPages)}>›</button>
        <button onClick={() => onPageChange(totalPages)} disabled={currentPage === totalPages} style={pageNavBtn(currentPage === totalPages)}>»</button>
      </div>
    </div>
  )
}

const GENERAL_VIEW_ID = '__general__'

interface RecordsTableProps {
  fields: Field[]
  records: BitacoraRecord[]
  allTags: Tag[]
  userRole: Role
  userEmail: string
  userName: string
  views: View[]
  initialRecordId?: string
}

export function RecordsTable({
  fields,
  records: initialRecords,
  allTags: initialTags,
  userRole,
  userEmail,
  userName,
  views: initialViews,
  initialRecordId,
}: RecordsTableProps) {
  const [fields_, setFields] = useState<Field[]>(fields)
  const [records, setRecords] = useState<BitacoraRecord[]>(initialRecords)
  const [tags, setTags] = useState<Tag[]>(initialTags)
  const [views, setViews] = useState<View[]>(initialViews)
  const [activeViewId, setActiveViewId] = useState<string>(GENERAL_VIEW_ID)
  const [showViewPanel, setShowViewPanel] = useState(false)
  const isApplyingViewRef = useRef(false)
  const [isPending, startTransition] = useTransition()

  // Frozen (pinned) columns
  const [pinnedFieldIds, setPinnedFieldIds] = useState<string[]>([])
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('bitacora-pinned-cols') ?? '[]')
      if (Array.isArray(saved) && saved.length > 0) setPinnedFieldIds(saved)
    } catch { /* ignore */ }
  }, [])
  // Single-table sticky columns
  const tableRef = useRef<HTMLTableElement>(null)
  const [stickyLefts, setStickyLefts] = useState<number[]>([])
  // Estado de hover sincronizado entre ambos paneles
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Modals / panels
  const [editingRecord, setEditingRecord] = useState<BitacoraRecord | null | 'new'>(null)
  const [detailRecord, setDetailRecord] = useState<BitacoraRecord | null>(null)
  const [editingField, setEditingField] = useState<Field | null | 'new'>(null)

  // Deep-link: abrir registro por URL (?record=<id>) — solo en el primer render
  useEffect(() => {
    if (!initialRecordId) return
    const target = records.find((r) => r.id === initialRecordId)
    if (target) setDetailRecord(target)
    // Solo corre una vez al montar — records es estable en este punto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sincronizar URL con el registro abierto (sin reload de página)
  useEffect(() => {
    const url = new URL(window.location.href)
    if (detailRecord) {
      url.searchParams.set('record', detailRecord.id)
    } else {
      url.searchParams.delete('record')
    }
    window.history.replaceState(null, '', url.toString())
  }, [detailRecord])
  const [showChatbot, setShowChatbot] = useState(false)
  const [missingFields, setMissingFields] = useState<string[]>([])

  // Column drag-to-reorder
  const [dragFieldId, setDragFieldId] = useState<string | null>(null)
  const [dragOverFieldId, setDragOverFieldId] = useState<string | null>(null)
  const [dragPosition, setDragPosition] = useState<'left' | 'right' | null>(null)

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Sync selection with Navbar via window event
  useEffect(() => {
    const ids = Array.from(selectedIds).join(',')
    window.dispatchEvent(new CustomEvent('bitacora-selection-change', { detail: ids }))
  }, [selectedIds])

  // Filters & Sorting
  const [search, setSearch] = useState('')
  const [filterFieldId, setFilterFieldId] = useState('')
  const [filterValue, setFilterValue] = useState('')
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Auto-save view filters when they change (skip General view and view-switching)
  useEffect(() => {
    if (activeViewId === GENERAL_VIEW_ID) return
    if (isApplyingViewRef.current) { isApplyingViewRef.current = false; return }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      const currentView = views.find(v => v.id === activeViewId)
      if (!currentView) return
      const filters: FilterState = { search, fieldId: filterFieldId, value: filterValue, dateFrom: '', dateTo: '', dateFieldId: '' }
      startTransition(async () => {
        const saved = await saveView({ id: activeViewId, name: currentView.name, emoji: currentView.emoji, filters, sort: sortConfig, order: currentView.order })
        setViews(prev => prev.map(v => v.id === saved.id ? saved : v))
      })
    }, 1000)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterFieldId, filterValue, sortConfig, activeViewId])

  const handleSwitchView = useCallback((viewId: string) => {
    isApplyingViewRef.current = true
    setActiveViewId(viewId)
    if (viewId === GENERAL_VIEW_ID) {
      setSearch(''); setFilterFieldId(''); setFilterValue(''); setSortConfig(null)
      setShowViewPanel(false)
      return
    }
    const view = views.find(v => v.id === viewId)
    if (!view) return
    setSearch(view.filters.search ?? '')
    setFilterFieldId(view.filters.fieldId ?? '')
    setFilterValue(view.filters.value ?? '')
    setSortConfig(view.sort)
    setShowViewPanel(true)
  }, [views])

  const handleCreateView = useCallback((name: string, emoji: string) => {
    const filters: FilterState = { search, fieldId: filterFieldId, value: filterValue, dateFrom: '', dateTo: '', dateFieldId: '' }
    startTransition(async () => {
      const created = await saveView({ name, emoji, filters, sort: sortConfig, order: views.length })
      setViews(prev => [...prev, created])
      setActiveViewId(created.id)
      setShowViewPanel(true)
    })
  }, [search, filterFieldId, filterValue, sortConfig, views.length])

  const handleUpdateView = useCallback((id: string, name: string, emoji: string) => {
    const currentView = views.find(v => v.id === id)
    if (!currentView) return
    startTransition(async () => {
      const saved = await saveView({ id, name, emoji, filters: currentView.filters, sort: currentView.sort, order: currentView.order })
      setViews(prev => prev.map(v => v.id === saved.id ? saved : v))
    })
  }, [views])

  const handleDeleteView = useCallback((id: string) => {
    startTransition(async () => {
      await deleteView(id)
      setViews(prev => prev.filter(v => v.id !== id))
      if (activeViewId === id) {
        isApplyingViewRef.current = true
        setActiveViewId(GENERAL_VIEW_ID)
        setSearch(''); setFilterFieldId(''); setFilterValue(''); setSortConfig(null)
      }
    })
  }, [activeViewId])

  const toggleSort = (fieldId: string) => {
    if (sortConfig?.fieldId === fieldId) {
      if (sortConfig.direction === 'asc') {
        setSortConfig({ fieldId, direction: 'desc' })
      } else {
        setSortConfig(null)
      }
    } else {
      setSortConfig({ fieldId, direction: 'asc' })
    }
  }

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const canEdit = true  // All roles can create and edit records
  const isAdmin = userRole === 'ADMIN' || userRole === 'MANAGER'  // Field management: ADMIN + MANAGER

  const visibleFields = fields_.filter((f) => f.isVisible)

  // First text-like field is treated as the "title"
  const titleFieldId = visibleFields.find((f) =>
    ['título', 'title', 'nombre', 'name'].includes(f.name.toLowerCase())
  )?.id ?? visibleFields[0]?.id

  // Filter records
  const filteredRecords = useMemo(() => {
    const result = records.filter((r) => {
      const matchSearch = !search || Object.values(r.data).some((v) =>
        String(v ?? '').toLowerCase().includes(search.toLowerCase())
      )
      const matchFilter = !filterFieldId || !filterValue ||
        String(r.data[filterFieldId] ?? '').toLowerCase().includes(filterValue.toLowerCase())
      return matchSearch && matchFilter
    })

    if (!sortConfig) return result

    return [...result].sort((a, b) => {
      let valA = a.data[sortConfig.fieldId]
      let valB = b.data[sortConfig.fieldId]

      // Extract raw values for arrays
      if (Array.isArray(valA)) valA = valA.join(', ')
      if (Array.isArray(valB)) valB = valB.join(', ')

      if (valA === valB) return 0
      if (valA == null || valA === '') return 1 // Nulls to the bottom
      if (valB == null || valB === '') return -1

      const strA = String(valA).toLowerCase()
      const strB = String(valB).toLowerCase()

      // Basic heuristic for numbers
      const numA = Number(valA)
      const numB = Number(valB)
      if (!isNaN(numA) && !isNaN(numB)) {
        return sortConfig.direction === 'asc' ? numA - numB : numB - numA
      }

      if (strA < strB) return sortConfig.direction === 'asc' ? -1 : 1
      if (strA > strB) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })
  }, [records, search, filterFieldId, filterValue, sortConfig])

  // Reset to page 1 when filters or sorts change
  useEffect(() => { setCurrentPage(1) }, [search, filterFieldId, filterValue, sortConfig])

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize))
  const clampedPage = Math.min(currentPage, totalPages)
  const paginatedRecords = filteredRecords.slice((clampedPage - 1) * pageSize, clampedPage * pageSize)

  function fieldCanEdit(field: Field) {
    if (!canEdit) return false
    const perm = field.permissions.find((p) => p.role === userRole)
    if (perm) return perm.canEdit
    return canEdit
  }

  const handleSaveRecord = useCallback(async (data: { id?: string; recordData: Record<string, unknown> }) => {
    startTransition(async () => {
      const saved = await saveRecord(data as Parameters<typeof saveRecord>[0])
      setRecords((prev) => {
        const idx = prev.findIndex((r) => r.id === saved.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = saved
          return next
        }
        return [saved, ...prev]
      })
    })
  }, [])

  const handleDeleteRecord = useCallback(async (id: string) => {
    startTransition(async () => {
      await deleteRecord(id)
      setRecords((prev) => prev.filter((r) => r.id !== id))
    })
  }, [])

  const handleSaveField = useCallback(async (data: Parameters<typeof saveField>[0]) => {
    startTransition(async () => {
      const saved = await saveField(data)
      setFields((prev) => {
        const idx = prev.findIndex((f) => f.id === saved.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = saved
          return next
        }
        return [...prev, saved].sort((a, b) => a.order - b.order)
      })
    })
  }, [])

  const handleDeleteField = useCallback(async (id: string) => {
    if (!confirm('¿Eliminar este campo? Los datos existentes se perderán.')) return
    startTransition(async () => {
      await deleteField(id)
      setFields((prev) => prev.filter((f) => f.id !== id))
    })
  }, [])

  const handleSaveTag = useCallback(async (data: Parameters<typeof saveTag>[0]) => {
    startTransition(async () => {
      const saved = await saveTag(data)
      setTags((prev) => {
        const idx = prev.findIndex((t) => t.id === saved.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = saved
          return next
        }
        return [...prev, saved]
      })
    })
  }, [])

  const handleDeleteTag = useCallback(async (id: string) => {
    startTransition(async () => {
      await deleteTag(id)
      setTags((prev) => prev.filter((t) => t.id !== id))
    })
  }, [])

  const handleTriggerButton = useCallback(async (record: BitacoraRecord, field: Field) => {
    // Validar campos requeridos antes de enviar
    const btnConfig = field.config as { sendAllFields?: boolean; selectedFieldIds?: string[] } | null
    if (btnConfig?.sendAllFields === false && (btnConfig.selectedFieldIds?.length ?? 0) > 0) {
      const missing = (btnConfig.selectedFieldIds ?? []).filter(fId => {
        const val = record.data[fId]
        if (val === null || val === undefined || val === '') return true
        if (Array.isArray(val) && val.length === 0) return true
        return false
      })
      if (missing.length > 0) {
        setMissingFields(missing.map(fId => fields_.find(f => f.id === fId)?.name ?? fId))
        return
      }
    }
    startTransition(async () => {
      try {
        await triggerButtonWebhook(record.id, field.id)
        const now = new Date().toISOString()
        setRecords((prev) => prev.map((r) =>
          r.id === record.id
            ? { ...r, data: { ...r.data, [field.id]: now } }
            : r
        ))
      } catch (e: unknown) {
        alert('Error: ' + (e instanceof Error ? e.message : String(e)))
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields_])

  const toggleAll = () => {
    if (selectedIds.size === filteredRecords.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredRecords.map(r => r.id)))
    }
  }

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  function togglePin(fieldId: string) {
    const idx = visibleFields.findIndex(f => f.id === fieldId)
    if (idx < 0) return
    setPinnedFieldIds(prev => {
      let next: string[]
      if (prev.includes(fieldId)) {
        // Desfijar esta columna y todas las que están a su derecha
        next = prev.filter(id => {
          const i = visibleFields.findIndex(f => f.id === id)
          return i >= 0 && i < idx
        })
      } else {
        // Fijar todas las columnas desde la 0 hasta esta (inclusive)
        next = visibleFields.slice(0, idx + 1).map(f => f.id)
      }
      localStorage.setItem('bitacora-pinned-cols', JSON.stringify(next))
      return next
    })
  }

  const activeFilters = (filterFieldId && filterValue)
    ? [{ fieldId: filterFieldId, value: filterValue, label: `${fields_.find(f => f.id === filterFieldId)?.name}: ${filterValue}` }]
    : []

  // Campos pineados vs no pineados
  const pinnedFields = visibleFields.filter(f => pinnedFieldIds.includes(f.id))
  const nonPinnedFields = visibleFields.filter(f => !pinnedFieldIds.includes(f.id))

  // Medir anchos de columnas fijas para calcular left de position:sticky
  useLayoutEffect(() => {
    const table = tableRef.current
    if (!table) return
    const ths = Array.from(table.querySelectorAll('thead tr th')) as HTMLElement[]
    const fixedCount = 1
    const stickyCount = fixedCount + pinnedFields.length
    const lefts: number[] = []
    let acc = 0
    for (let i = 0; i < stickyCount; i++) {
      lefts.push(acc)
      acc += ths[i]?.offsetWidth ?? 0
    }
    setStickyLefts(prev =>
      prev.length === lefts.length && prev.every((v, i) => v === lefts[i]) ? prev : lefts
    )
  }, [paginatedRecords, pinnedFieldIds, visibleFields, isAdmin, pinnedFields.length])

  return (
    <div className="bitacora-table-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <style>{`
        .table-scroll::-webkit-scrollbar { height: 20px; width: 20px; }
        .table-scroll::-webkit-scrollbar-track { background: #f1f5f9; border-top: 1px solid #e2e8f0; }
        .table-scroll::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 10px; border: 5px solid #f1f5f9; }
        .table-scroll::-webkit-scrollbar-thumb:hover { background: #475569; }
        .table-scroll { scrollbar-width: auto; scrollbar-color: #94a3b8 #f1f5f9; }

        tbody tr.tr-odd  { background: #fff; }
        tbody tr.tr-even { background: #fafbfc; }
        tbody tr.tr-selected { background: #f0fdfa; }
        tbody tr.tr-hover { background: #f0fdfa; }
      `}</style>
      {/* View tabs */}
      <ViewTabs
        views={views}
        activeViewId={activeViewId}
        onSwitch={handleSwitchView}
        onCreate={handleCreateView}
        onUpdate={handleUpdateView}
        onDelete={handleDeleteView}
      />

      {/* View filter panel — solo para vistas guardadas */}
      {activeViewId !== GENERAL_VIEW_ID && showViewPanel && (
        <div style={{
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          padding: '10px 20px',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          flexShrink: 0,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filtros</span>

          {/* Field filter */}
          <select value={filterFieldId} onChange={(e) => { setFilterFieldId(e.target.value); setFilterValue('') }}
            style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff' }}>
            <option value="">Campo...</option>
            {fields_.filter(f => f.isFilterable && ['select','multiselect','text'].includes(f.type)).map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>

          {filterFieldId && (
            fields_.find(f => f.id === filterFieldId)?.type === 'select' || fields_.find(f => f.id === filterFieldId)?.type === 'multiselect'
              ? <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)}
                  style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff' }}>
                  <option value="">Todos</option>
                  {tags.filter(t => t.fieldId === filterFieldId).map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              : <input type="text" placeholder="Valor..." value={filterValue} onChange={(e) => setFilterValue(e.target.value)}
                  style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', width: 130 }} />
          )}

          <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginLeft: 8 }}>Ordenar</span>

          <select value={sortConfig?.fieldId ?? ''} onChange={(e) => setSortConfig(e.target.value ? { fieldId: e.target.value, direction: sortConfig?.direction ?? 'asc' } : null)}
            style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff' }}>
            <option value="">Sin orden</option>
            {visibleFields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>

          {sortConfig && (
            <select value={sortConfig.direction} onChange={(e) => setSortConfig({ ...sortConfig, direction: e.target.value as 'asc' | 'desc' })}
              style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff', width: 120 }}>
              <option value="asc">Ascendente</option>
              <option value="desc">Descendente</option>
            </select>
          )}

          <div style={{ flex: 1 }} />

          <button onClick={() => {
            const currentView = views.find(v => v.id === activeViewId)
            if (!currentView) return
            const filters: FilterState = { search, fieldId: filterFieldId, value: filterValue, dateFrom: '', dateTo: '', dateFieldId: '' }
            startTransition(async () => {
              const saved = await saveView({ id: activeViewId, name: currentView.name, emoji: currentView.emoji, filters, sort: sortConfig, order: currentView.order })
              setViews(prev => prev.map(v => v.id === saved.id ? saved : v))
            })
            setShowViewPanel(false)
          }} style={{
            padding: '6px 16px', background: '#00C4A0', color: '#fff',
            border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}>Guardar</button>

          <button onClick={() => setShowViewPanel(false)} style={{
            padding: '6px 10px', background: 'none', color: '#94a3b8',
            border: '1px solid #e2e8f0', borderRadius: 7, cursor: 'pointer', fontSize: 13,
          }}>×</button>
        </div>
      )}

      {/* Inner content: toolbar + table (position relative para el panel lateral) */}
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e2e8f0',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          {/* Field filter + Sort — solo en vista General */}
          {activeViewId === GENERAL_VIEW_ID && (<>
          <select
            value={filterFieldId}
            onChange={(e) => { setFilterFieldId(e.target.value); setFilterValue('') }}
            style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}
          >
            <option value="">Filtrar por campo...</option>
            {fields_.filter((f) => f.isFilterable && (f.type === 'select' || f.type === 'multiselect' || f.type === 'text')).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>

          {filterFieldId && (
            fields_.find(f => f.id === filterFieldId)?.type === 'select' || fields_.find(f => f.id === filterFieldId)?.type === 'multiselect'
              ? (
                <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)}
                  style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}>
                  <option value="">Todos</option>
                  {tags.filter(t => t.fieldId === filterFieldId).map(t => (
                    <option key={t.id} value={t.name}>{t.name}</option>
                  ))}
                </select>
              ) : (
                <input type="text" placeholder="Valor..." value={filterValue} onChange={(e) => setFilterValue(e.target.value)}
                  style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none', width: 140 }} />
              )
          )}

          {activeFilters.map((f, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: '#E0F7F4', color: '#00A888',
              border: '1px solid #00C4A0', borderRadius: 20,
              padding: '4px 10px', fontSize: 12, fontWeight: 500,
            }}>
              {f.label}
              <span style={{ cursor: 'pointer', fontSize: 14, opacity: 0.7 }}
                onClick={() => { setFilterFieldId(''); setFilterValue('') }}>×</span>
            </span>
          ))}

          {/* Sort Button */}
          <div style={{ position: 'relative' }} ref={sortMenuRef}>
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 12px', borderRadius: 8, fontSize: 13,
                fontWeight: 500, cursor: 'pointer',
                background: sortConfig ? '#e0f7f4' : '#fff',
                color: sortConfig ? '#00A888' : '#4a5568',
                border: `1px solid ${sortConfig ? '#00C4A0' : '#e2e8f0'}`,
                transition: 'all 0.1s',
              }}
            >
              <span style={{ fontSize: 14 }}>⇅</span>
              {sortConfig ? 'Ordenado' : 'Ordenar'}
            </button>

            {/* Sort Popover Menu */}
            {showSortMenu && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: 6,
                background: '#fff', borderRadius: 8,
                boxShadow: '0 4px 20px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)',
                width: 320, zIndex: 120, overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
              }}>
                <div style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9', background: '#fafbfc' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>Ordenar por</span>
                </div>
                
                <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {!sortConfig ? (
                    <button
                      onClick={() => setSortConfig({ fieldId: visibleFields[0]?.id || '', direction: 'asc' })}
                      style={{
                        background: 'transparent', border: 'none', color: '#3b82f6',
                        fontSize: 13, cursor: 'pointer', textAlign: 'left',
                        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 0',
                      }}
                    >
                      + Añadir ordenamiento
                    </button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <select
                        value={sortConfig.fieldId}
                        onChange={(e) => setSortConfig({ ...sortConfig, fieldId: e.target.value })}
                        style={{
                          flex: 1, padding: '6px 8px', border: '1px solid #e2e8f0',
                          borderRadius: 6, fontSize: 13, color: '#374151', outline: 'none',
                        }}
                      >
                        {visibleFields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                      <select
                        value={sortConfig.direction}
                        onChange={(e) => setSortConfig({ ...sortConfig, direction: e.target.value as 'asc' | 'desc' })}
                        style={{
                          width: 100, padding: '6px 8px', border: '1px solid #e2e8f0',
                          borderRadius: 6, fontSize: 13, color: '#374151', outline: 'none',
                        }}
                      >
                        <option value="asc">Ascendente</option>
                        <option value="desc">Descendente</option>
                      </select>
                      <button
                        onClick={() => setSortConfig(null)}
                        style={{
                          background: 'none', border: 'none', color: '#94a3b8',
                          cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px',
                        }}
                        title="Quitar"
                      >×</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          </>)}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {selectedIds.size > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '0 10px', borderRight: '1px solid #e2e8f0', marginRight: 4 }}>
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{selectedIds.size} seleccionados</span>
              <button onClick={() => setSelectedIds(new Set())}
                style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>Limpiar</button>
            </div>
          )}

          {/* Search — siempre a la derecha */}
          <input type="text" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, width: 200, outline: 'none' }} />

          <button onClick={() => setShowChatbot(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8, fontSize: 13,
            fontWeight: 500, cursor: 'pointer', background: '#fff', color: '#4a5568', border: '1px solid #e2e8f0',
          }}>💬 Chatbot</button>

          {canEdit && (
            <button onClick={() => setEditingRecord('new')} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, fontSize: 13,
              fontWeight: 500, cursor: 'pointer', background: '#00C4A0', color: '#fff', border: 'none',
            }}>+ Nuevo registro</button>
          )}
        </div>
      </div>

      {isPending && (
        <div style={{ padding: '4px 20px', fontSize: 12, color: '#00C4A0', flexShrink: 0 }}>
          Guardando…
        </div>
      )}

      {/* Tabla única con columnas sticky */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: '0 20px 20px', display: 'flex', flexDirection: 'column' }}>
        <div
          className="table-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            overflowX: 'auto',
            overflowY: 'auto',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06)',
            border: '1px solid #e8edf2',
          }}
        >
          <table
            ref={tableRef}
            style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'auto', minWidth: 'max-content', width: '100%' }}
          >
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 40, padding: '0 0 0 16px', position: 'sticky', left: stickyLefts[0] ?? 0, top: 0, zIndex: 4 }}>
                  <input type="checkbox" checked={filteredRecords.length > 0 && selectedIds.size === filteredRecords.length} onChange={toggleAll} style={{ width: 16, height: 16, accentColor: '#00C4A0', cursor: 'pointer' }} />
                </th>
                {pinnedFields.map((field, i) => {
                  const fixedCount = 1
                  const isLastSticky = i === pinnedFields.length - 1
                  return (
                    <th key={field.id}
                      style={{ ...thStyle, cursor: 'pointer', position: 'sticky', left: stickyLefts[fixedCount + i] ?? 0, top: 0, zIndex: 4, boxShadow: isLastSticky ? '4px 0 8px -2px rgba(0,196,160,0.25)' : undefined }}
                      onClick={() => toggleSort(field.id)}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                          <FieldTypeIcon type={field.type} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{field.name}</span>
                          {sortConfig?.fieldId === field.id && <span style={{ color: '#00C4A0', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}
                        </span>
                        <span style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                          <button onClick={(e) => { e.stopPropagation(); togglePin(field.id) }} title="Desfijar columna" style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#E0F7F4', border: '1px solid #00C4A0', borderRadius: 4, cursor: 'pointer', padding: 0 }}>
                            <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 4l3-3 3 3M3 9h8M7 9v4" stroke="#00A888" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                          {isAdmin && <button onClick={(e) => { e.stopPropagation(); setEditingField(field) }} title="Editar campo" style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', padding: 0 }}>
                            <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z" stroke="#64748b" strokeWidth="1.4" strokeLinejoin="round"/></svg>
                          </button>}
                        </span>
                      </span>
                    </th>
                  )
                })}
                {nonPinnedFields.map((field) => (
                  <th key={field.id}
                    draggable={isAdmin}
                    onDragStart={(e) => { setDragFieldId(field.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move' }}
                    onDragOver={(e) => { e.preventDefault(); if (!dragFieldId || dragFieldId === field.id) return; setDragOverFieldId(field.id); const rect = e.currentTarget.getBoundingClientRect(); setDragPosition(e.clientX - rect.left < rect.width / 2 ? 'left' : 'right') }}
                    onDragLeave={() => { setDragOverFieldId(null); setDragPosition(null) }}
                    onDrop={(e) => { e.preventDefault(); if (!dragFieldId || dragFieldId === field.id || !dragPosition) { setDragFieldId(null); setDragOverFieldId(null); setDragPosition(null); return } const allIds = fields_.map(f => f.id); const fromIdx = allIds.indexOf(dragFieldId); let toIdx = allIds.indexOf(field.id); if (dragPosition === 'right') toIdx += 1; if (fromIdx < toIdx) toIdx -= 1; const next = [...allIds]; next.splice(fromIdx, 1); next.splice(toIdx, 0, dragFieldId); startTransition(async () => { await reorderFields(next); setFields(prev => { const map = new Map(prev.map(f => [f.id, f])); return next.map((id, i) => ({ ...map.get(id)!, order: i + 1 })) }) }); setDragFieldId(null); setDragOverFieldId(null); setDragPosition(null) }}
                    onDragEnd={() => { setDragFieldId(null); setDragOverFieldId(null); setDragPosition(null) }}
                    style={{ ...thStyle, cursor: 'pointer', position: 'sticky', top: 0, zIndex: 1, background: dragFieldId === field.id ? '#f8fafc' : thStyle.background, opacity: dragFieldId === field.id ? 0.3 : 1, borderLeft: dragOverFieldId === field.id && dragPosition === 'left' ? '3px solid #00C4A0' : thStyle.borderLeft, borderRight: dragOverFieldId === field.id && dragPosition === 'right' ? '3px solid #00C4A0' : thStyle.borderRight, transition: 'border 0.1s, background 0.1s' }}
                    onClick={(e) => { const t = e.target as HTMLElement; if (t.tagName !== 'BUTTON' && t.tagName !== 'svg' && t.tagName !== 'path' && t.tagName !== 'circle' && t.tagName !== 'polygon') toggleSort(field.id) }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        {isAdmin && <span style={{ color: '#cbd5e1', fontSize: 12, cursor: 'grab', lineHeight: 1, flexShrink: 0 }} title="Arrastra para reordenar">⠿</span>}
                        <FieldTypeIcon type={field.type} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{field.name}</span>
                        {sortConfig?.fieldId === field.id && <span style={{ color: '#00C4A0', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}
                      </span>
                      <span style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                        <button onClick={(e) => { e.stopPropagation(); togglePin(field.id) }} title="Fijar columna" style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', padding: 0 }}>
                          <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 4l3-3 3 3M3 9h8M7 9v4" stroke="#94a3b8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                        {isAdmin && <button onClick={(e) => { e.stopPropagation(); setEditingField(field) }} title="Editar campo" style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', padding: 0 }}>
                          <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z" stroke="#64748b" strokeWidth="1.4" strokeLinejoin="round"/></svg>
                        </button>}
                      </span>
                    </span>
                  </th>
                ))}
                {isAdmin && <th style={{ ...thStyle, cursor: 'pointer', position: 'sticky', top: 0, zIndex: 1 }} onClick={() => setEditingField('new')} title="Agregar campo">+ Campo</th>}
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={1 + (isAdmin ? 1 : 0) + visibleFields.length} style={{ textAlign: 'center', padding: '60px 20px', color: '#a0aec0' }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                    <div style={{ fontSize: 15, color: '#718096', marginBottom: 4 }}>{records.length === 0 ? 'No hay registros aún' : 'Sin resultados para los filtros aplicados'}</div>
                  </td>
                </tr>
              ) : paginatedRecords.map((record, rowIdx) => {
                const fixedCount = 1
                const stickyBg = (hoveredId === record.id || selectedIds.has(record.id)) ? '#f0fdfa' : rowIdx % 2 === 0 ? '#fff' : '#fafbfc'
                return (
                  <tr key={record.id}
                    className={`${selectedIds.has(record.id) ? 'tr-selected' : rowIdx % 2 === 1 ? 'tr-even' : 'tr-odd'} ${hoveredId === record.id ? 'tr-hover' : ''}`}
                    style={{ borderBottom: '1px solid #edf2f7' }}
                    onMouseEnter={() => setHoveredId(record.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <td style={{ ...tdStyle, width: 40, padding: '0 0 0 16px', position: 'sticky', left: stickyLefts[0] ?? 0, zIndex: 2, background: stickyBg }}>
                      <input type="checkbox" checked={selectedIds.has(record.id)} onChange={() => toggleOne(record.id)} style={{ width: 16, height: 16, accentColor: '#00C4A0', cursor: 'pointer' }} />
                    </td>
                    {pinnedFields.map((field, i) => {
                      const isLastSticky = i === pinnedFields.length - 1
                      return (
                        <td key={field.id} style={{ ...tdStyle, position: 'sticky', left: stickyLefts[fixedCount + i] ?? 0, zIndex: 2, background: stickyBg, boxShadow: isLastSticky ? '4px 0 8px -2px rgba(0,196,160,0.25)' : undefined }}>
                          {field.type === 'button' ? (() => { const w = Boolean(record.data[field.id]); return (<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: w ? '#dcfce7' : '#f1f5f9', color: w ? '#166534' : '#64748b', border: `1px solid ${w ? '#86efac' : '#e2e8f0'}` }}>{w ? '✅ Sí' : '⬜ No'}</span><button onClick={() => handleTriggerButton(record, field)} disabled={isPending} style={{ padding: '3px 8px', fontSize: 11, fontWeight: 500, background: w ? '#f8fafc' : '#E0F7F4', color: w ? '#475569' : '#00A888', border: `1px solid ${w ? '#e2e8f0' : '#00C4A0'}`, borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>{w ? '↺ Re-ejecutar' : '⚡ Ejecutar'}</button></div>) })() : field.id === titleFieldId ? <TitleCell record={record} field={field} onClick={() => setDetailRecord(record)} /> : <CellValue field={field} value={record.data[field.id]} allTags={tags} />}
                        </td>
                      )
                    })}
                    {nonPinnedFields.map((field) => (
                      <td key={field.id} style={{ ...tdStyle }}>
                        {field.type === 'button' ? (() => { const w = Boolean(record.data[field.id]); return (<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: w ? '#dcfce7' : '#f1f5f9', color: w ? '#166534' : '#64748b', border: `1px solid ${w ? '#86efac' : '#e2e8f0'}` }}>{w ? '✅ Sí' : '⬜ No'}</span><button onClick={() => handleTriggerButton(record, field)} disabled={isPending} style={{ padding: '3px 8px', fontSize: 11, fontWeight: 500, background: w ? '#f8fafc' : '#E0F7F4', color: w ? '#475569' : '#00A888', border: `1px solid ${w ? '#e2e8f0' : '#00C4A0'}`, borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>{w ? '↺ Re-ejecutar' : '⚡ Ejecutar'}</button></div>) })() : field.id === titleFieldId ? <TitleCell record={record} field={field} onClick={() => setDetailRecord(record)} /> : <CellValue field={field} value={record.data[field.id]} allTags={tags} />}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Panel lateral — dentro del área toolbar+tabla, no tapa paginación */}
      {detailRecord !== null && (
        <RecordDetail
          record={detailRecord}
          fields={fields_}
          tags={tags}
          userRole={userRole}
          onSave={async (data) => {
            await handleSaveRecord(data)
            setDetailRecord((prev) => prev ? { ...prev, data: data.recordData } : null)
          }}
          onClose={() => setDetailRecord(null)}
          onDelete={async () => {
            setDetailRecord(null)           // cerrar panel de inmediato
            await handleDeleteRecord(detailRecord.id)
          }}
        />
      )}
      {editingRecord !== null && (
        <RecordEditor
          record={editingRecord === 'new' ? null : editingRecord}
          fields={fields_}
          tags={tags}
          userRole={userRole}
          onSave={async (data) => {
            await handleSaveRecord(data)
            setEditingRecord(null)
          }}
          onClose={() => setEditingRecord(null)}
        />
      )}
      </div>{/* fin inner content */}

      {/* Pagination */}
      <PaginationBar
        currentPage={clampedPage}
        totalPages={totalPages}
        pageSize={pageSize}
        filteredCount={filteredRecords.length}
        totalCount={records.length}
        onPageChange={setCurrentPage}
        onPageSizeChange={(s) => { setPageSize(s); setCurrentPage(1) }}
      />

      {editingField !== null && (
        <FieldEditor
          field={editingField === 'new' ? null : editingField}
          fields={fields_.filter(f => f.type !== 'button')}
          tags={tags}
          onSave={async (data) => {
            await handleSaveField(data)
            setEditingField(null)
          }}
          onDelete={editingField !== 'new' ? async () => {
            await handleDeleteField((editingField as Field).id)
            setEditingField(null)
          } : undefined}
          onSaveTag={handleSaveTag}
          onDeleteTag={handleDeleteTag}
          onClose={() => setEditingField(null)}
        />
      )}

      {showChatbot && <Chatbot onClose={() => setShowChatbot(false)} />}

      {/* Modal: campos requeridos incompletos */}
      {missingFields.length > 0 && (
        <>
          <div
            onClick={() => setMissingFields([])}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 500 }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 501,
            background: '#fff', borderRadius: 14,
            boxShadow: '0 20px 60px rgba(15,23,42,0.2)',
            width: 'min(420px, 90vw)',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #fee2e2', background: '#fff5f5' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>⚠️</span>
                <div>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#b91c1c' }}>
                    Campos requeridos incompletos
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#ef4444' }}>
                    Completa estos campos antes de enviar
                  </p>
                </div>
              </div>
            </div>
            {/* Field list */}
            <div style={{ padding: '16px 24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {missingFields.map((name, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', borderRadius: 8,
                    background: '#fafafa', border: '1px solid #fecaca',
                  }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: '#fee2e2', border: '1px solid #fca5a5',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: '#ef4444', flexShrink: 0,
                    }}>{i + 1}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#1a202c' }}>{name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#ef4444', fontWeight: 600 }}>VACÍO</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Footer */}
            <div style={{ padding: '12px 24px 20px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setMissingFields([])}
                style={{
                  padding: '8px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer',
                }}
              >
                Entendido
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '10px 16px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: '#64748b',
  whiteSpace: 'nowrap',
  userSelect: 'none',
  borderRight: '1px solid #f1f5f9',
  borderBottom: '2px solid #e2e8f0',
  position: 'sticky',
  top: 0,
  background: '#f8fafc',
  zIndex: 1,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
}

const tdStyle: React.CSSProperties = {
  padding: '11px 16px',
  verticalAlign: 'middle',
  fontSize: 13,
  color: '#374151',
  borderRight: '1px solid #f1f5f9',
  maxWidth: 280,
}

const actionBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #e2e8f0',
  color: '#64748b',
  padding: '4px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 500,
}
