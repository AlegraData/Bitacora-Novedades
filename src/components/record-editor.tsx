'use client'

import { useState } from 'react'
import type { Field, BitacoraRecord, Tag, Role, RecordData } from '@/types'
import { PersonPicker } from './person-picker'

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({ id: record?.id, recordData: formData })
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
        const selected = Array.isArray(value) ? value : String(value ?? '').split(',').map(v => v.trim()).filter(Boolean)
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
        const selected = Array.isArray(value) ? value : String(value ?? '').split(',').map(v => v.trim()).filter(Boolean)
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
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      zIndex: 200, display: 'flex', alignItems: 'flex-start',
      justifyContent: 'center', paddingTop: 60,
    }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#fff', borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
        width: '100%', maxWidth: 560,
        maxHeight: 'calc(100vh - 120px)',
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
            color: '#a0aec0', fontSize: 20, lineHeight: 1, padding: 4,
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
    </div>
  )
}
