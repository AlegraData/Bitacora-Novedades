'use client'

import { useState } from 'react'
import type { Field, BitacoraRecord, Tag, Role, RecordData, Block } from '@/types'
import { PersonPicker } from './person-picker'

function uid() { return Math.random().toString(36).slice(2, 10) }

interface RecordEditorProps {
  record: BitacoraRecord | null
  fields: Field[]
  tags: Tag[]
  userRole: Role
  onSave: (data: { id?: string; recordData: RecordData }) => Promise<void>
  onClose: () => void
}

export function RecordEditor({ record, fields, tags, userRole, onSave, onClose }: RecordEditorProps) {
  const isNew = !record
  const [formData, setFormData] = useState<RecordData>(record?.data ?? {})
  const [blocks, setBlocks] = useState<Block[]>(() => {
    const raw = record?.data?.['__blocks__']
    return Array.isArray(raw) ? (raw as Block[]) : []
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const visibleFields = fields.filter((f) => f.isVisible && f.type !== 'button')

  function canEditField(field: Field) {
    if (userRole === 'ADMIN') return true
    const perm = field.permissions.find((p) => p.role === userRole)
    if (perm) return perm.canEdit
    return userRole === 'MANAGER'
  }

  function setField(fieldId: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [fieldId]: value as RecordData[string] }))
  }

  function addBlock(type: Block['type']) {
    setBlocks((prev) => [...prev, { id: uid(), type, content: type === 'divider' ? '' : '' }])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({ id: record?.id, recordData: { ...formData, __blocks__: blocks as RecordData[string] } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  function renderField(field: Field) {
    const value = formData[field.id]
    const editable = canEditField(field)
    const fieldTags = tags.filter((t) => t.fieldId === field.id)
    const commonStyle: React.CSSProperties = {
      width: '100%', padding: '8px 12px',
      border: '1px solid #e2e8f0', borderRadius: 8,
      fontSize: 14, outline: 'none',
      background: editable ? '#fff' : '#f7fafc',
      color: editable ? '#1a202c' : '#718096',
    }

    switch (field.type) {
      case 'text':
      case 'url':
        return (
          <input
            type={field.type === 'url' ? 'url' : 'text'}
            value={String(value ?? '')}
            onChange={(e) => setField(field.id, e.target.value)}
            disabled={!editable}
            style={commonStyle}
          />
        )
      case 'textarea':
        return (
          <textarea
            value={String(value ?? '')}
            onChange={(e) => setField(field.id, e.target.value)}
            disabled={!editable}
            rows={3}
            style={{ ...commonStyle, resize: 'vertical', minHeight: 80 }}
          />
        )
      case 'number':
        return (
          <input
            type="number"
            value={String(value ?? '')}
            onChange={(e) => setField(field.id, e.target.value ? Number(e.target.value) : '')}
            disabled={!editable}
            style={commonStyle}
          />
        )
      case 'date':
        return (
          <input
            type="date"
            value={String(value ?? '').slice(0, 10)}
            onChange={(e) => setField(field.id, e.target.value)}
            disabled={!editable}
            style={commonStyle}
          />
        )
      case 'checkbox':
        return (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: editable ? 'pointer' : 'default' }}>
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => setField(field.id, e.target.checked)}
              disabled={!editable}
              style={{ width: 18, height: 18, accentColor: '#00C4A0' }}
            />
            <span style={{ fontSize: 14, color: '#4a5568' }}>{Boolean(value) ? 'Sí' : 'No'}</span>
          </label>
        )
      case 'select':
        return (
          <select
            value={String(value ?? '')}
            onChange={(e) => setField(field.id, e.target.value)}
            disabled={!editable}
            style={commonStyle}
          >
            <option value="">— Seleccionar —</option>
            {fieldTags.map((t) => (
              <option key={t.id} value={t.name}>{t.name}</option>
            ))}
          </select>
        )
      case 'multiselect': {
        const selected = Array.isArray(value) ? (value as string[]) : String(value || '').split(',').map((v) => v.trim()).filter(Boolean)
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            {fieldTags.map((t) => {
              const isSelected = selected.includes(t.name)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    if (!editable) return
                    const next = isSelected
                      ? selected.filter((s) => s !== t.name)
                      : [...selected, t.name]
                    setField(field.id, next)
                  }}
                  style={{
                    padding: '3px 10px',
                    borderRadius: 20,
                    border: `1.5px solid ${isSelected ? t.color : '#e2e8f0'}`,
                    background: isSelected ? t.color + '33' : '#fff',
                    color: isSelected ? '#1a202c' : '#718096',
                    cursor: editable ? 'pointer' : 'default',
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  {t.name}
                </button>
              )
            })}
            {fieldTags.length === 0 && <span style={{ color: '#a0aec0', fontSize: 13 }}>Sin opciones definidas</span>}
          </div>
        )
      }
      case 'person': {
        const selected = Array.isArray(value) ? (value as string[]) : String(value || '').split(',').map((v) => v.trim()).filter(Boolean)
        const personConfig = field.config as { multiple?: boolean } | null
        const max = personConfig?.multiple === false ? 1 : undefined
        return (
          <PersonPicker
            value={selected}
            onChange={(v) => setField(field.id, v)}
            disabled={!editable}
            max={max}
          />
        )
      }
      default:
        return (
          <input
            type="text"
            value={String(value ?? '')}
            onChange={(e) => setField(field.id, e.target.value)}
            disabled={!editable}
            style={commonStyle}
          />
        )
    }
  }

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(15,23,42,0.25)',
      }} />

      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 301,
        width: 'min(720px, 62vw)',
        background: '#fff',
        boxShadow: '-6px 0 40px rgba(15,23,42,0.14)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1a202c' }}>
            {isNew ? 'Nuevo registro' : 'Editar registro'}
          </h3>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#a0aec0', fontSize: 24, lineHeight: 1, padding: '4px 8px',
          }}>×</button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
            {visibleFields.map((field) => (
              <div key={field.id} style={{ marginBottom: 18 }}>
                <label style={{
                  display: 'block', fontSize: 12, fontWeight: 600,
                  color: '#718096', marginBottom: 6,
                  textTransform: 'uppercase', letterSpacing: '0.4px',
                }}>
                  {field.name}
                </label>
                {renderField(field)}
              </div>
            ))}

            {visibleFields.length === 0 && (
              <div style={{ textAlign: 'center', color: '#a0aec0', padding: '40px 0' }}>
                No hay campos configurados. Un administrador debe agregar campos primero.
              </div>
            )}

            {/* Content / Blocks */}
            <div style={{ marginTop: 32, marginBottom: 24 }}>
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
                    onMoveUp={idx > 0 ? () => setBlocks((prev) => {
                      const next = [...prev]; [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]; return next
                    }) : undefined}
                    onMoveDown={idx < blocks.length - 1 ? () => setBlocks((prev) => {
                      const next = [...prev]; [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]; return next
                    }) : undefined}
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

            {error && (
              <div style={{
                padding: '10px 14px', background: '#fff5f5',
                border: '1px solid #fc8181', borderRadius: 8,
                color: '#c53030', fontSize: 13,
              }}>
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '16px 24px', borderTop: '1px solid #e2e8f0',
            display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0,
          }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px', background: '#fff', color: '#4a5568',
                border: '1px solid #e2e8f0', borderRadius: 8,
                cursor: 'pointer', fontSize: 13, fontWeight: 500,
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '8px 20px', background: saving ? '#a0aec0' : '#00C4A0',
                color: '#fff', border: 'none', borderRadius: 8,
                cursor: saving ? 'default' : 'pointer', fontSize: 13, fontWeight: 500,
              }}
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Block row component ──────────────────────────────────────────────────────

function BlockRow({
  block, onUpdate, onDelete, onMoveUp, onMoveDown,
}: {
  block: Block
  onUpdate: (content: string) => void
  onDelete: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  const [hovered, setHovered] = useState(false)

  if (block.type === 'divider') {
    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}
      >
        <hr style={{ flex: 1, border: 'none', borderTop: '2px solid #e2e8f0', margin: 0 }} />
        {hovered && (
          <button type="button" onClick={onDelete} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#cbd5e1', fontSize: 15, lineHeight: 1, padding: '0 2px', flexShrink: 0,
          }}>×</button>
        )}
      </div>
    )
  }

  const isBold = block.type === 'bold'

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}
    >
      {/* Move handles */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 1,
        opacity: hovered ? 1 : 0, transition: 'opacity 0.1s',
        paddingTop: 4,
      }}>
        <button type="button" onClick={onMoveUp} disabled={!onMoveUp} style={{
          background: 'none', border: 'none', cursor: onMoveUp ? 'pointer' : 'default',
          color: onMoveUp ? '#94a3b8' : '#e2e8f0', fontSize: 10, lineHeight: 1, padding: '1px 3px',
        }}>▲</button>
        <button type="button" onClick={onMoveDown} disabled={!onMoveDown} style={{
          background: 'none', border: 'none', cursor: onMoveDown ? 'pointer' : 'default',
          color: onMoveDown ? '#94a3b8' : '#e2e8f0', fontSize: 10, lineHeight: 1, padding: '1px 3px',
        }}>▼</button>
      </div>

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
          border: `1px solid ${hovered ? '#e2e8f0' : 'transparent'}`,
          borderRadius: 6,
          fontSize: isBold ? 15 : 14,
          fontWeight: isBold ? 700 : 400,
          color: '#0f172a', fontFamily: 'inherit',
          background: hovered ? '#f8fafc' : 'transparent',
          outline: 'none', lineHeight: 1.55,
          transition: 'border-color 0.12s, background 0.12s',
        }}
        onFocus={(e) => { e.target.style.background = '#fff'; e.target.style.borderColor = '#00C4A0' }}
        onBlur={(e) => { e.target.style.background = hovered ? '#f8fafc' : 'transparent'; e.target.style.borderColor = hovered ? '#e2e8f0' : 'transparent' }}
      />

      {/* Delete */}
      <button type="button" onClick={onDelete} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: '#cbd5e1', fontSize: 16, lineHeight: 1,
        padding: '6px 4px', flexShrink: 0,
        opacity: hovered ? 1 : 0, transition: 'opacity 0.1s',
      }}>×</button>
    </div>
  )
}
