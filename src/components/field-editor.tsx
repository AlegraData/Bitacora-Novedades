'use client'

import { useState } from 'react'
import type { Field, Tag } from '@/types'

const FIELD_TYPES = [
  { value: 'text', label: 'Texto', icon: 'T' },
  { value: 'textarea', label: 'Texto largo', icon: '¶' },
  { value: 'number', label: 'Número', icon: '#' },
  { value: 'date', label: 'Fecha', icon: '📅' },
  { value: 'select', label: 'Selección', icon: '▾' },
  { value: 'multiselect', label: 'Multi-selección', icon: '▾▾' },
  { value: 'person', label: 'Persona', icon: '👤' },
  { value: 'url', label: 'URL', icon: '🔗' },
  { value: 'checkbox', label: 'Checkbox', icon: '☑' },
  { value: 'button', label: 'Botón / Email', icon: '⚡' },
]

const TAG_COLORS = [
  '#718096', '#e53e3e', '#dd6b20', '#d69e2e',
  '#38a169', '#3182ce', '#805ad5', '#d53f8c',
  '#00C4A0', '#2d3748',
]

interface FieldEditorProps {
  field: Field | null
  tags: Tag[]
  onSave: (data: {
    id?: string
    name: string
    type: string
    isFilterable?: boolean
    isVisible?: boolean
    config?: Record<string, unknown> | null
    order?: number
  }) => Promise<void>
  onDelete?: () => Promise<void>
  onSaveTag: (data: { id?: string; fieldId: string; name: string; color?: string }) => Promise<void>
  onDeleteTag: (id: string) => Promise<void>
  onClose: () => void
}

export function FieldEditor({
  field,
  tags,
  onSave,
  onDelete,
  onSaveTag,
  onDeleteTag,
  onClose,
}: FieldEditorProps) {
  const isNew = !field
  const fieldTags = tags.filter((t) => t.fieldId === field?.id)

  const [name, setName] = useState(field?.name ?? '')
  const [type, setType] = useState<string>(field?.type ?? 'text')
  const [isFilterable, setIsFilterable] = useState(field?.isFilterable ?? true)
  const [isVisible, setIsVisible] = useState(field?.isVisible ?? true)
  const [config, setConfig] = useState<Record<string, string>>(
    (field?.config as unknown as Record<string, string>) ?? {}
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Tag management
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0])

  const needsTags = type === 'select' || type === 'multiselect'
  const isButton = type === 'button'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('El nombre es requerido'); return }
    setSaving(true)
    setError('')
    try {
      await onSave({
        id: field?.id,
        name: name.trim(),
        type,
        isFilterable,
        isVisible,
        config: isButton ? { ...config, action: 'send_email' } : null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddTag() {
    if (!newTagName.trim() || !field?.id) return
    await onSaveTag({ fieldId: field.id, name: newTagName.trim(), color: newTagColor })
    setNewTagName('')
  }

  async function handleDeleteTag(tagId: string) {
    if (!confirm('¿Eliminar esta etiqueta?')) return
    await onDeleteTag(tagId)
  }

  return (
    <div
      style={{
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
          padding: '20px 24px', borderBottom: '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1a202c' }}>
            {isNew ? 'Nuevo campo' : `Editar: ${field.name}`}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a0aec0', fontSize: 20 }}>×</button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
            {/* Name */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Nombre del campo</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Estado, Responsable, Fecha límite..."
                style={inputStyle}
                autoFocus
              />
            </div>

            {/* Type */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Tipo de campo</label>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 4,
              }}>
                {FIELD_TYPES.map((ft) => (
                  <button
                    key={ft.value}
                    type="button"
                    onClick={() => setType(ft.value)}
                    style={{
                      padding: 10,
                      border: `1.5px solid ${type === ft.value ? '#00C4A0' : '#e2e8f0'}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'center',
                      background: type === ft.value ? '#E0F7F4' : '#fff',
                    }}
                  >
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{ft.icon}</div>
                    <div style={{ fontSize: 11, color: '#4a5568', fontWeight: 500 }}>{ft.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Toggles */}
            <div style={{ marginBottom: 18 }}>
              <ToggleRow
                label="Visible en la tabla"
                checked={isVisible}
                onChange={setIsVisible}
              />
              <ToggleRow
                label="Filtrable"
                checked={isFilterable}
                onChange={setIsFilterable}
              />
            </div>

            {/* Button config */}
            {isButton && (
              <div style={{ marginBottom: 18, padding: 16, background: '#f7fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <label style={{ ...labelStyle, marginBottom: 12 }}>Configuración del botón de email</label>
                {[
                  { key: 'targetFieldId', label: 'ID del campo de destinatarios', placeholder: 'field_id del campo email' },
                  { key: 'emailSubject', label: 'Asunto (usa {{NombreCampo}})', placeholder: 'Novedad: {{Título}}' },
                  { key: 'emailBody', label: 'Cuerpo del correo', placeholder: 'Hola, se registró una novedad...' },
                  { key: 'logFieldId', label: 'ID campo de log (opcional)', placeholder: 'field_id para registrar envíos' },
                ].map(({ key, label, placeholder }) => (
                  <div key={key} style={{ marginBottom: 12 }}>
                    <label style={{ ...labelStyle, fontSize: 11 }}>{label}</label>
                    {key === 'emailBody' ? (
                      <textarea
                        value={config[key] ?? ''}
                        onChange={(e) => setConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                        rows={3}
                        placeholder={placeholder}
                        style={{ ...inputStyle, resize: 'vertical', minHeight: 70 }}
                      />
                    ) : (
                      <input
                        type="text"
                        value={config[key] ?? ''}
                        onChange={(e) => setConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder={placeholder}
                        style={inputStyle}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Tags management (select/multiselect) */}
            {needsTags && !isNew && (
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Opciones / Etiquetas</label>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  {fieldTags.map((tag) => (
                    <div key={tag.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', background: '#f7fafc',
                      borderRadius: 8, border: '1px solid #e2e8f0',
                    }}>
                      <span style={{
                        width: 16, height: 16, borderRadius: '50%',
                        background: tag.color, flexShrink: 0,
                        border: '2px solid #fff', boxShadow: '0 0 0 1px #e2e8f0',
                      }} />
                      <span style={{ flex: 1, fontSize: 13, color: '#2d3748' }}>{tag.name}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteTag(tag.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53e3e', fontSize: 16 }}
                      >×</button>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag() } }}
                    placeholder="Nueva opción..."
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <div style={{ display: 'flex', gap: 4 }}>
                    {TAG_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewTagColor(c)}
                        style={{
                          width: 20, height: 20, borderRadius: '50%',
                          background: c, border: `2px solid ${newTagColor === c ? '#1a202c' : '#fff'}`,
                          boxShadow: '0 0 0 1px #e2e8f0',
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleAddTag}
                    style={{
                      padding: '7px 14px', background: '#00C4A0', color: '#fff',
                      border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13,
                    }}
                  >
                    +
                  </button>
                </div>
                {needsTags && isNew && (
                  <p style={{ fontSize: 12, color: '#a0aec0', marginTop: 8 }}>
                    Guarda el campo primero para poder agregar opciones.
                  </p>
                )}
              </div>
            )}

            {error && (
              <div style={{ padding: '10px 14px', background: '#fff5f5', border: '1px solid #fc8181', borderRadius: 8, color: '#c53030', fontSize: 13 }}>
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '16px 24px', borderTop: '1px solid #e2e8f0',
            display: 'flex', justifyContent: 'space-between', gap: 10, flexShrink: 0,
          }}>
            <div>
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  style={{
                    padding: '8px 16px', background: '#fff', color: '#e53e3e',
                    border: '1px solid #feb2b2', borderRadius: 8,
                    cursor: 'pointer', fontSize: 13, fontWeight: 500,
                  }}
                >
                  Eliminar campo
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
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
                {saving ? 'Guardando...' : 'Guardar campo'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 0', borderBottom: '1px solid #f0f4f8',
    }}>
      <span style={{ fontSize: 13, color: '#4a5568' }}>{label}</span>
      <label style={{ position: 'relative', width: 40, height: 22, cursor: 'pointer' }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
          style={{ opacity: 0, width: 0, height: 0 }} />
        <span style={{
          position: 'absolute', inset: 0,
          background: checked ? '#00C4A0' : '#cbd5e0',
          borderRadius: 22, transition: '0.2s',
        }}>
          <span style={{
            position: 'absolute',
            width: 16, height: 16,
            left: checked ? 21 : 3, top: 3,
            background: '#fff', borderRadius: '50%',
            transition: '0.2s',
          }} />
        </span>
      </label>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: '#718096', marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: '0.4px',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px',
  border: '1px solid #e2e8f0', borderRadius: 8,
  fontSize: 14, outline: 'none',
  background: '#fff', color: '#1a202c',
}
