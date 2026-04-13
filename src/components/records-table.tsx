'use client'

import { useState, useTransition, useCallback, useEffect } from 'react'
import type { Field, BitacoraRecord, Tag, FilterState, Role } from '@/types'
import { saveRecord, deleteRecord } from '@/lib/actions/records'
import { saveField, deleteField, reorderFields } from '@/lib/actions/fields'
import { saveTag, deleteTag } from '@/lib/actions/tags'
import { triggerButtonEmail } from '@/lib/actions/email'
import { RecordEditor } from './record-editor'
import { FieldEditor } from './field-editor'
import { Chatbot } from './chatbot'

const FIELD_TYPE_ICONS: Record<string, string> = {
  text: 'T',
  textarea: '¶',
  number: '#',
  date: '📅',
  select: '▾',
  multiselect: '▾▾',
  person: '👤',
  button: '⚡',
  url: '🔗',
  checkbox: '☑',
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
        const d = new Date(String(value))
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

interface RecordsTableProps {
  fields: Field[]
  records: BitacoraRecord[]
  allTags: Tag[]
  userRole: Role
  userEmail: string
  userName: string
}

export function RecordsTable({
  fields,
  records: initialRecords,
  allTags: initialTags,
  userRole,
  userEmail,
  userName,
}: RecordsTableProps) {
  const [fields_, setFields] = useState<Field[]>(fields)
  const [records, setRecords] = useState<BitacoraRecord[]>(initialRecords)
  const [tags, setTags] = useState<Tag[]>(initialTags)
  const [isPending, startTransition] = useTransition()

  // Modals
  const [editingRecord, setEditingRecord] = useState<BitacoraRecord | null | 'new'>(null)
  const [editingField, setEditingField] = useState<Field | null | 'new'>(null)
  const [showChatbot, setShowChatbot] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [filterFieldId, setFilterFieldId] = useState('')
  const [filterValue, setFilterValue] = useState('')

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const canEdit = userRole === 'ADMIN' || userRole === 'MANAGER'
  const isAdmin = userRole === 'ADMIN'

  const visibleFields = fields_.filter((f) => f.isVisible)

  // Filter records
  const filteredRecords = records.filter((r) => {
    const matchSearch = !search || Object.values(r.data).some((v) =>
      String(v ?? '').toLowerCase().includes(search.toLowerCase())
    )
    const matchFilter = !filterFieldId || !filterValue ||
      String(r.data[filterFieldId] ?? '').toLowerCase().includes(filterValue.toLowerCase())
    return matchSearch && matchFilter
  })

  // Reset to page 1 when filters change
  useEffect(() => { setCurrentPage(1) }, [search, filterFieldId, filterValue])

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
    if (!confirm('¿Eliminar este registro?')) return
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

  const handleTriggerButton = useCallback(async (recordId: string, fieldId: string) => {
    startTransition(async () => {
      try {
        const result = await triggerButtonEmail(recordId, fieldId)
        alert(`Correo enviado a: ${result.emails.join(', ')}`)
      } catch (e: unknown) {
        alert('Error al enviar: ' + (e instanceof Error ? e.message : String(e)))
      }
    })
  }, [])

  const activeFilters = (filterFieldId && filterValue)
    ? [{ fieldId: filterFieldId, value: filterValue, label: `${fields_.find(f => f.id === filterFieldId)?.name}: ${filterValue}` }]
    : []

  return (
    <>
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
          {/* Search */}
          <input
            type="text"
            placeholder="Buscar en registros..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '7px 12px',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              fontSize: 13,
              width: 220,
              outline: 'none',
            }}
          />

          {/* Field filter */}
          <select
            value={filterFieldId}
            onChange={(e) => { setFilterFieldId(e.target.value); setFilterValue('') }}
            style={{
              padding: '7px 10px',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              fontSize: 13,
              outline: 'none',
              background: '#fff',
            }}
          >
            <option value="">Filtrar por campo...</option>
            {fields_.filter((f) => f.isFilterable && (f.type === 'select' || f.type === 'multiselect' || f.type === 'text')).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>

          {filterFieldId && (
            fields_.find(f => f.id === filterFieldId)?.type === 'select' || fields_.find(f => f.id === filterFieldId)?.type === 'multiselect'
              ? (
                <select
                  value={filterValue}
                  onChange={(e) => setFilterValue(e.target.value)}
                  style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}
                >
                  <option value="">Todos</option>
                  {tags.filter(t => t.fieldId === filterFieldId).map(t => (
                    <option key={t.id} value={t.name}>{t.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="Valor..."
                  value={filterValue}
                  onChange={(e) => setFilterValue(e.target.value)}
                  style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none', width: 140 }}
                />
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
              <span
                style={{ cursor: 'pointer', fontSize: 14, opacity: 0.7 }}
                onClick={() => { setFilterFieldId(''); setFilterValue('') }}
              >×</span>
            </span>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setShowChatbot(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, fontSize: 13,
              fontWeight: 500, cursor: 'pointer',
              background: '#fff', color: '#4a5568',
              border: '1px solid #e2e8f0',
            }}
          >
            💬 Chatbot
          </button>

          {canEdit && (
            <button
              onClick={() => setEditingRecord('new')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 8, fontSize: 13,
                fontWeight: 500, cursor: 'pointer',
                background: '#00C4A0', color: '#fff', border: 'none',
              }}
            >
              + Nuevo registro
            </button>
          )}
        </div>
      </div>

      {isPending && (
        <div style={{ padding: '4px 20px', fontSize: 12, color: '#00C4A0', flexShrink: 0 }}>
          Guardando…
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 20px 20px' }}>
        <div style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06)',
          border: '1px solid #e8edf2',
          overflow: 'clip',
          minWidth: 'fit-content',
        }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'auto' }}>
            <thead>
              <tr style={{ background: '#1e2a3a' }}>
                <th style={thStyle}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    ID
                  </span>
                </th>
                {visibleFields.map((field) => (
                  <th key={field.id} style={thStyle}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, opacity: 0.6 }}>{FIELD_TYPE_ICONS[field.type] ?? 'T'}</span>
                      {field.name}
                      {isAdmin && (
                        <button
                          onClick={() => setEditingField(field)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: '#a0aec0', fontSize: 11, padding: '0 2px',
                            opacity: 0.5,
                          }}
                          title="Editar campo"
                        >✏️</button>
                      )}
                    </span>
                  </th>
                ))}
                {isAdmin && (
                  <th
                    style={{ ...thStyle, cursor: 'pointer' }}
                    onClick={() => setEditingField('new')}
                    title="Agregar campo"
                  >
                    + Campo
                  </th>
                )}
                <th style={thStyle}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={visibleFields.length + 3} style={{ textAlign: 'center', padding: '60px 20px', color: '#a0aec0' }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                    <div style={{ fontSize: 15, color: '#718096', marginBottom: 4 }}>
                      {records.length === 0 ? 'No hay registros aún' : 'Sin resultados para los filtros aplicados'}
                    </div>
                    {canEdit && records.length === 0 && (
                      <div style={{ fontSize: 13, color: '#a0aec0' }}>
                        Haz clic en &quot;Nuevo registro&quot; para comenzar
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedRecords.map((record, rowIdx) => (
                  <tr key={record.id}
                    style={{ borderBottom: '1px solid #edf2f7', background: rowIdx % 2 === 1 ? '#fafbfc' : '#fff' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f0fdfa')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = rowIdx % 2 === 1 ? '#fafbfc' : '#fff')}
                  >
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <code style={{
                        fontSize: 10, color: '#94a3b8', background: '#f1f5f9',
                        padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace',
                      }}>
                        {record.id.slice(0, 8)}
                      </code>
                    </td>
                    {visibleFields.map((field) => (
                      <td key={field.id} style={tdStyle}>
                        {field.type === 'button' ? (
                          <button
                            onClick={() => handleTriggerButton(record.id, field.id)}
                            disabled={isPending}
                            style={{
                              padding: '4px 12px',
                              background: '#E0F7F4',
                              color: '#00A888',
                              border: '1px solid #00C4A0',
                              borderRadius: 6,
                              cursor: 'pointer',
                              fontSize: 12,
                              fontWeight: 500,
                            }}
                          >
                            ⚡ {field.name}
                          </button>
                        ) : (
                          <CellValue field={field} value={record.data[field.id]} allTags={tags} />
                        )}
                      </td>
                    ))}
                    {isAdmin && <td style={tdStyle} />}
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {(canEdit && fieldCanEdit(visibleFields[0] ?? fields_[0])) && (
                        <button
                          onClick={() => setEditingRecord(record)}
                          style={actionBtnStyle}
                        >
                          Editar
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => handleDeleteRecord(record.id)}
                          style={{ ...actionBtnStyle, color: '#e53e3e', marginLeft: 4 }}
                        >
                          Eliminar
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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

      {/* Record Editor Modal */}
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

      {/* Field Editor Modal */}
      {editingField !== null && (
        <FieldEditor
          field={editingField === 'new' ? null : editingField}
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

      {/* Chatbot */}
      {showChatbot && (
        <Chatbot onClose={() => setShowChatbot(false)} />
      )}
    </>
  )
}

const thStyle: React.CSSProperties = {
  padding: '11px 16px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 700,
  color: '#94a3b8',
  whiteSpace: 'nowrap',
  userSelect: 'none',
  borderRight: '1px solid rgba(255,255,255,0.07)',
  position: 'sticky',
  top: 0,
  background: '#1e2a3a',
  zIndex: 1,
  letterSpacing: '0.06em',
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
