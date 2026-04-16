'use client'

import { useState, useRef, useEffect } from 'react'
import type { Field, BitacoraRecord, Tag, Role, RecordData, Block } from '@/types'
import { PersonPicker } from './person-picker'
import { MultiSelectDropdown } from './multi-select-dropdown'

function uid() { return Math.random().toString(36).slice(2, 10) }

// ── Conditional field visibility constants ────────────────────────────────────
const COMM_CONTROLLER = 'necesita comunicación de product marketing'
const COMM_DEPENDENT_NAMES = new Set([
  'usuario impactado', 'taxonomia feature', 'evento feature amplitude',
  'comentario evento', 'link tablero amplitude', 'manual de usuario', 'artículo help center',
])
function naValueForType(type: string): unknown {
  if (type === 'checkbox') return false
  if (type === 'multiselect' || type === 'person') return []
  return 'N/A'
}

interface RecordDetailProps {
  record: BitacoraRecord
  fields: Field[]
  tags: Tag[]
  userRole: Role
  onSave: (data: { id: string; recordData: RecordData }) => Promise<void>
  onClose: () => void
  onDelete?: () => Promise<void>
}

export function RecordDetail({ record, fields, tags, userRole, onSave, onClose, onDelete }: RecordDetailProps) {
  const [formData, setFormData] = useState<RecordData>(record.data)
  const [blocks, setBlocks] = useState<Block[]>(() => {
    const raw = record.data['__blocks__']
    return Array.isArray(raw) ? (raw as Block[]) : []
  })
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [copied, setCopied] = useState(false)

  function copyLink() {
    const url = `${window.location.origin}/app?record=${record.id}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstRender = useRef(true)
  const [dragBlockIdx, setDragBlockIdx] = useState<number | null>(null)
  const [dragOverBlockIdx, setDragOverBlockIdx] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const visibleFields = fields.filter((f) => f.isVisible && f.type !== 'button')

  // Conditional visibility: "Necesita comunicación de Product Marketing"
  const commField = visibleFields.find(f => f.name.toLowerCase().trim() === COMM_CONTROLLER)
  const commIsNo = commField
    ? (commField.type === 'checkbox'
      ? !formData[commField.id]
      : String(formData[commField.id] ?? '').toLowerCase().trim() === 'no')
    : false

  // Detect title field (show large at top)
  const titleField = visibleFields.find((f) =>
    ['título', 'title', 'nombre', 'name'].includes(f.name.toLowerCase())
  ) ?? visibleFields[0]
  const propertyFields = visibleFields.filter((f) => {
    if (f.id === titleField?.id) return false
    if (commIsNo && COMM_DEPENDENT_NAMES.has(f.name.toLowerCase().trim())) return false
    return true
  })

  function canEditField(field: Field) {
    const perm = field.permissions.find((p) => p.role === userRole)
    if (perm) return perm.canEdit
    return true  // All roles can edit by default
  }

  function setField(fieldId: string, value: unknown) {
    setFormData((prev) => {
      const next: RecordData = { ...prev, [fieldId]: value as RecordData[string] }
      // Auto-fill dependents with N/A when controlling field is set to NO
      if (commField && fieldId === commField.id) {
        const nowNo = commField.type === 'checkbox'
          ? !value
          : String(value ?? '').toLowerCase().trim() === 'no'
        if (nowNo) {
          for (const f of visibleFields) {
            if (COMM_DEPENDENT_NAMES.has(f.name.toLowerCase().trim())) {
              next[f.id] = naValueForType(f.type) as RecordData[string]
            }
          }
        }
      }
      return next
    })
  }

  // Auto-save con debounce de 800ms
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setStatus('saving')
    debounceRef.current = setTimeout(async () => {
      try {
        await onSave({
          id: record.id,
          recordData: { ...formData, __blocks__: blocks as RecordData[string] },
        })
        setStatus('saved')
        setTimeout(() => setStatus('idle'), 2000)
      } catch {
        setStatus('error')
      }
    }, 800)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, blocks])

  // ── Field rendering ───────────────────────────────────────────────────────

  function renderField(field: Field) {
    const value = formData[field.id]
    const editable = canEditField(field)
    const fieldTags = tags.filter((t) => t.fieldId === field.id)
    const base: React.CSSProperties = {
      width: '100%', padding: '6px 9px',
      border: '1px solid #e2e8f0', borderRadius: 6,
      fontSize: 13, outline: 'none', fontFamily: 'inherit',
      background: editable ? '#fff' : '#f8fafc',
      color: editable ? '#1a202c' : '#94a3b8',
    }

    switch (field.type) {
      case 'text':
      case 'url':
        return (
          <input type={field.type === 'url' ? 'url' : 'text'}
            value={String(value ?? '')} onChange={(e) => setField(field.id, e.target.value)}
            disabled={!editable} style={base} />
        )
      case 'textarea':
        return (
          <textarea value={String(value ?? '')} onChange={(e) => setField(field.id, e.target.value)}
            disabled={!editable} rows={3}
            style={{ ...base, resize: 'vertical', minHeight: 70 }} />
        )
      case 'number':
        return (
          <input type="number" value={String(value ?? '')}
            onChange={(e) => setField(field.id, e.target.value ? Number(e.target.value) : '')}
            disabled={!editable} style={base} />
        )
      case 'date':
        return (
          <input type="date" value={String(value ?? '').slice(0, 10)}
            onChange={(e) => setField(field.id, e.target.value)}
            disabled={!editable} style={base} />
        )
      case 'checkbox':
        return (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: editable ? 'pointer' : 'default' }}>
            <input type="checkbox" checked={Boolean(value)}
              onChange={(e) => setField(field.id, e.target.checked)}
              disabled={!editable} style={{ width: 15, height: 15, accentColor: '#00C4A0' }} />
            <span style={{ fontSize: 13, color: '#4a5568' }}>{Boolean(value) ? 'Sí' : 'No'}</span>
          </label>
        )
      case 'select':
        return (
          <select value={String(value ?? '')} onChange={(e) => setField(field.id, e.target.value)}
            disabled={!editable} style={base}>
            <option value="">— Seleccionar —</option>
            {fieldTags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        )
      case 'multiselect': {
        const selected = Array.isArray(value)
          ? (value as string[])
          : String(value ?? '').split(',').map((v) => v.trim()).filter(Boolean)
        return (
          <MultiSelectDropdown
            options={fieldTags}
            value={selected}
            onChange={(v) => setField(field.id, v)}
            disabled={!editable}
          />
        )
      }
      case 'person': {
        const selected = Array.isArray(value)
          ? (value as string[])
          : String(value ?? '').split(',').map((v) => v.trim()).filter(Boolean)
        const personConfig = field.config as { multiple?: boolean } | null
        const max = personConfig?.multiple === false ? 1 : undefined
        return <PersonPicker value={selected} onChange={(v) => setField(field.id, v)} disabled={!editable} max={max} />
      }
      default:
        return <input type="text" value={String(value ?? '')}
          onChange={(e) => setField(field.id, e.target.value)} disabled={!editable} style={base} />
    }
  }

  // ── Block helpers ─────────────────────────────────────────────────────────

  function addBlock(type: Block['type']) {
    setBlocks((prev) => [...prev, { id: uid(), type, content: type === 'divider' ? '' : '' }])
  }

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0, zIndex: 300,
        background: 'rgba(15,23,42,0.18)',
      }} />

      {/* Sliding panel */}
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 301,
        width: 'min(720px, 62%)',
        background: '#fff',
        boxShadow: '-6px 0 40px rgba(15,23,42,0.14)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 24px',
          borderBottom: '1px solid #f1f5f9',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Detalle del registro
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {status === 'saving' && (
              <span style={{ fontSize: 12, color: '#94a3b8' }}>Guardando…</span>
            )}
            {status === 'saved' && (
              <span style={{ fontSize: 12, color: '#00C4A0', fontWeight: 500 }}>✓ Guardado</span>
            )}
            {status === 'error' && (
              <span style={{ fontSize: 12, color: '#ef4444' }}>Error al guardar</span>
            )}
            {/* Botón copiar enlace */}
            <button
              onClick={copyLink}
              title="Copiar enlace a este registro"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: copied ? '#f0fdf9' : 'none',
                border: copied ? '1px solid #00C4A0' : '1px solid #e2e8f0',
                borderRadius: 6, cursor: 'pointer',
                color: copied ? '#00C4A0' : '#94a3b8',
                fontSize: 11, fontWeight: 500,
                padding: '4px 9px', transition: 'all 0.15s',
              }}
            >
              {copied ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Copiado
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M5.5 8.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    <path d="M3.5 9.5a2.5 2.5 0 010-3.5l1.5-1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    <path d="M9 4.5l1.5-1.5a2.5 2.5 0 010 3.5l-1.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  Compartir
                </>
              )}
            </button>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#94a3b8', fontSize: 22, lineHeight: 1, padding: '2px 4px',
            }}>×</button>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '32px 36px 48px' }}>

          {/* Title */}
          {titleField && (
            <div style={{ marginBottom: 32 }}>
              {canEditField(titleField) ? (
                <input
                  type="text"
                  value={String(formData[titleField.id] ?? '')}
                  onChange={(e) => setField(titleField.id, e.target.value)}
                  placeholder="Sin título…"
                  style={{
                    width: '100%', fontSize: 28, fontWeight: 700, color: '#0f172a',
                    border: 'none', outline: 'none', padding: 0,
                    background: 'transparent', fontFamily: 'inherit',
                    lineHeight: 1.25,
                  }}
                />
              ) : (
                <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', margin: 0, lineHeight: 1.25 }}>
                  {String(formData[titleField.id] ?? 'Sin título')}
                </h1>
              )}
            </div>
          )}

          {/* Properties */}
          {propertyFields.length > 0 && (
            <div style={{
              borderRadius: 10, border: '1px solid #e2e8f0',
              overflow: 'hidden', marginBottom: 36,
            }}>
              {propertyFields.map((field, i) => (
                <div key={field.id} style={{
                  display: 'grid', gridTemplateColumns: '148px 1fr',
                  alignItems: 'start',
                  borderBottom: i < propertyFields.length - 1 ? '1px solid #f1f5f9' : 'none',
                }}>
                  <div style={{
                    padding: '10px 14px',
                    fontSize: 11, fontWeight: 600, color: '#64748b',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    background: '#f8fafc',
                    borderRight: '1px solid #f1f5f9',
                    paddingTop: 13,
                  }}>
                    {field.name}
                  </div>
                  <div style={{ padding: '8px 12px', background: '#fff' }}>
                    {renderField(field)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Content / Blocks */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                Contenido
              </span>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16 }}>
              {blocks.map((block, idx) => (
                <BlockRow
                  key={block.id}
                  block={block}
                  onUpdate={(content) =>
                    setBlocks((prev) => prev.map((b) => b.id === block.id ? { ...b, content } : b))
                  }
                  onDelete={() => setBlocks((prev) => prev.filter((b) => b.id !== block.id))}
                  onDragStart={() => setDragBlockIdx(idx)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverBlockIdx(idx) }}
                  onDrop={() => {
                    if (dragBlockIdx === null || dragBlockIdx === idx) return
                    setBlocks((prev) => {
                      const next = [...prev]
                      const [moved] = next.splice(dragBlockIdx, 1)
                      next.splice(idx, 0, moved)
                      return next
                    })
                    setDragBlockIdx(null)
                    setDragOverBlockIdx(null)
                  }}
                  isDragOver={dragOverBlockIdx === idx}
                />
              ))}
              {blocks.length === 0 && (
                <p style={{ color: '#a0aec0', fontSize: 13, margin: '4px 0 12px', fontStyle: 'italic' }}>
                  Sin contenido — agrega un bloque para comenzar.
                </p>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              {([
                { type: 'paragraph' as const, label: '＋ Texto' },
                { type: 'bold' as const, label: '＋ Negrita' },
                { type: 'divider' as const, label: '＋ Línea' },
              ]).map(({ type, label }) => (
                <button key={type} type="button" onClick={() => addBlock(type)} style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', background: '#f8fafc', color: '#475569',
                  border: '1px solid #e2e8f0',
                }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Zona de eliminación — solo admins */}
          {onDelete && (
            <div style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid #f1f5f9' }}>
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'none', border: '1px solid #fecaca', borderRadius: 7,
                    color: '#ef4444', fontSize: 12, fontWeight: 500,
                    padding: '6px 14px', cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#fff5f5'; e.currentTarget.style.borderColor = '#ef4444' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = '#fecaca' }}
                >
                  <span style={{ fontSize: 13 }}>🗑</span> Eliminar registro
                </button>
              ) : (
                <div style={{
                  background: '#fff5f5', border: '1px solid #fecaca',
                  borderRadius: 10, padding: '16px 20px',
                  display: 'flex', flexDirection: 'column', gap: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>⚠️</span>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#b91c1c' }}>
                        ¿Eliminar este registro?
                      </p>
                      <p style={{ margin: '3px 0 0', fontSize: 12, color: '#ef4444' }}>
                        Esta acción es permanente y no se puede deshacer.
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      style={{
                        padding: '7px 16px', borderRadius: 7, fontSize: 13, fontWeight: 500,
                        background: '#fff', color: '#64748b',
                        border: '1px solid #e2e8f0', cursor: 'pointer',
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={async () => {
                        setDeleting(true)
                        try { await onDelete() } finally { setDeleting(false) }
                      }}
                      style={{
                        padding: '7px 18px', borderRadius: 7, fontSize: 13, fontWeight: 600,
                        background: deleting ? '#fca5a5' : '#ef4444', color: '#fff',
                        border: 'none', cursor: deleting ? 'default' : 'pointer',
                        transition: 'background 0.15s',
                      }}
                    >
                      {deleting ? 'Eliminando…' : 'Sí, eliminar'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Block row component ──────────────────────────────────────────────────────

function BlockRow({
  block, onUpdate, onDelete, onDragStart, onDragOver, onDrop, isDragOver,
}: {
  block: Block
  onUpdate: (content: string) => void
  onDelete: () => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  isDragOver: boolean
}) {
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: 6, padding: '2px 0',
    borderTop: isDragOver ? '2px solid #00C4A0' : '2px solid transparent',
    transition: 'border-color 0.1s',
  }

  const handle = (
    <span
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart() }}
      title="Arrastrar para mover"
      style={{
        cursor: 'grab', color: '#cbd5e0', fontSize: 16, lineHeight: 1,
        paddingTop: 6, flexShrink: 0, userSelect: 'none',
      }}
    >⠿</span>
  )

  const deleteBtn = (
    <button type="button" onClick={onDelete} title="Eliminar bloque" style={{
      background: 'none', border: '1px solid #e2e8f0', borderRadius: 4,
      cursor: 'pointer', color: '#94a3b8', fontSize: 14, lineHeight: 1,
      padding: '4px 7px', flexShrink: 0, marginTop: 4,
    }}>×</button>
  )

  if (block.type === 'divider') {
    return (
      <div
        style={{ ...rowStyle, alignItems: 'center' }}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {handle}
        <hr style={{ flex: 1, border: 'none', borderTop: '2px solid #e2e8f0', margin: '0 4px' }} />
        {deleteBtn}
      </div>
    )
  }

  const isBold = block.type === 'bold'

  return (
    <div style={rowStyle} onDragOver={onDragOver} onDrop={onDrop}>
      {handle}
      <textarea
        value={block.content ?? ''}
        onChange={(e) => {
          onUpdate(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = e.target.scrollHeight + 'px'
        }}
        placeholder={isBold ? 'Título en negrita…' : 'Escribe algo…'}
        rows={1}
        style={{
          flex: 1, resize: 'none', overflow: 'hidden',
          padding: '6px 10px',
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          fontSize: isBold ? 15 : 14,
          fontWeight: isBold ? 700 : 400,
          color: '#0f172a', fontFamily: 'inherit',
          background: '#fafafa',
          outline: 'none', lineHeight: 1.55,
        }}
        onFocus={(e) => { e.target.style.background = '#fff'; e.target.style.borderColor = '#00C4A0' }}
        onBlur={(e) => { e.target.style.background = '#fafafa'; e.target.style.borderColor = '#e2e8f0' }}
      />
      {deleteBtn}
    </div>
  )
}
