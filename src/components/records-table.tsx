'use client'

import { useState, useTransition, useCallback } from 'react'
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

function TagChip({ tag }: { tag: Tag }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 500,
      background: tag.color + '33',
      color: tag.color === '#e2e8f0' ? '#4a5568' : tag.color,
      border: `1px solid ${tag.color}66`,
      margin: '1px',
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
      return <span style={{ fontSize: 16 }}>{value ? '✅' : '⬜'}</span>
    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noopener noreferrer"
          style={{ color: '#00C4A0', textDecoration: 'none', fontSize: 12 }}>
          {String(value).replace(/^https?:\/\//, '')}
        </a>
      )
    case 'person': {
      const names = Array.isArray(value) ? value : String(value).split(',').map((v) => v.trim())
      return (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {names.map((n, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px 2px 4px', borderRadius: 20,
              background: '#f0f4f8', fontSize: 12,
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%',
                background: '#00C4A0', display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 600, color: '#fff',
              }}>
                {n.charAt(0).toUpperCase()}
              </span>
              {n}
            </span>
          ))}
        </span>
      )
    }
    case 'date':
      try {
        return <span>{new Date(String(value)).toLocaleDateString('es-CO')}</span>
      } catch {
        return <span>{String(value)}</span>
      }
    case 'textarea':
      return (
        <span style={{
          display: 'block', whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis', maxWidth: 200,
        }} title={String(value)}>
          {String(value)}
        </span>
      )
    default:
      return (
        <span style={{
          display: 'block', whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis', maxWidth: 200,
        }}>
          {String(value)}
        </span>
      )
  }
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

      {/* Count */}
      <div style={{ padding: '6px 20px', fontSize: 12, color: '#a0aec0', flexShrink: 0 }}>
        {filteredRecords.length} registro{filteredRecords.length !== 1 ? 's' : ''}
        {filteredRecords.length !== records.length && ` (de ${records.length})`}
        {isPending && <span style={{ marginLeft: 8, color: '#00C4A0' }}>Guardando...</span>}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 20px' }}>
        <div style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          overflow: 'hidden',
          minWidth: 'fit-content',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
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
                filteredRecords.map((record) => (
                  <tr key={record.id} style={{ borderBottom: '1px solid #f0f4f8' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f7fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ ...tdStyle, color: '#a0aec0', fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {record.id.slice(0, 8)}…
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
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 600,
  color: '#a0aec0',
  whiteSpace: 'nowrap',
  userSelect: 'none',
  borderRight: '1px solid rgba(255,255,255,0.06)',
}

const tdStyle: React.CSSProperties = {
  padding: '9px 14px',
  verticalAlign: 'middle',
  fontSize: 13,
  color: '#4a5568',
  borderRight: '1px solid #f0f4f8',
  maxWidth: 280,
}

const actionBtnStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  color: '#4a5568',
  padding: '4px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
}
