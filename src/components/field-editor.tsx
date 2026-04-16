'use client'

import { useState } from 'react'
import type { Field, Tag } from '@/types'

function FieldTypeIcon({ type, size = 16 }: { type: string; size?: number }) {
  const s = { display: 'inline-flex' as const, alignItems: 'center' as const, justifyContent: 'center' as const }
  const c = '#64748b'
  const w = size, h = size
  switch (type) {
    case 'text': return <span style={s}><svg width={w} height={h} viewBox="0 0 14 14" fill="none"><path d="M2 4.5h10M2 7.5h7M2 10.5h8.5" stroke={c} strokeWidth="1.6" strokeLinecap="round"/></svg></span>
    case 'textarea': return <span style={s}><svg width={w} height={h} viewBox="0 0 14 14" fill="none"><path d="M2 3.5h10M2 6.5h10M2 9.5h6.5" stroke={c} strokeWidth="1.6" strokeLinecap="round"/><path d="M10 10.5l2 2-2 0" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    case 'number': return <span style={s}><svg width={w} height={h} viewBox="0 0 14 14" fill="none"><path d="M5.5 2l-1.5 10M10 2l-1.5 10M2 5.5h10M2 8.5h10" stroke={c} strokeWidth="1.5" strokeLinecap="round"/></svg></span>
    case 'date': return <span style={s}><svg width={w} height={h} viewBox="0 0 14 14" fill="none"><rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke={c} strokeWidth="1.4"/><path d="M1.5 6h11" stroke={c} strokeWidth="1.4"/><path d="M4.5 1v3M9.5 1v3" stroke={c} strokeWidth="1.5" strokeLinecap="round"/><circle cx="4.5" cy="9" r="0.9" fill={c}/><circle cx="7" cy="9" r="0.9" fill={c}/><circle cx="9.5" cy="9" r="0.9" fill={c}/></svg></span>
    case 'select': return <span style={s}><svg width={w} height={h} viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke={c} strokeWidth="1.4"/><path d="M4.5 7l2.5 2.5 2.5-2.5" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    case 'multiselect': return <span style={s}><svg width={w} height={h} viewBox="0 0 14 14" fill="none"><path d="M2 4.5h5M2 9.5h5" stroke={c} strokeWidth="1.5" strokeLinecap="round"/><rect x="9" y="2.5" width="3.5" height="3.5" rx="0.8" stroke={c} strokeWidth="1.3"/><rect x="9" y="7.5" width="3.5" height="3.5" rx="0.8" stroke={c} strokeWidth="1.3"/><path d="M9.5 4.2l0.8 0.8 1.2-1.2" stroke={c} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    case 'person': return <span style={s}><svg width={w} height={h} viewBox="0 0 14 14" fill="none"><circle cx="7" cy="4.5" r="2.5" stroke={c} strokeWidth="1.4"/><path d="M2 12.5c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke={c} strokeWidth="1.4" strokeLinecap="round"/></svg></span>
    case 'button': return <span style={s}><svg width={w} height={h} viewBox="0 0 14 14" fill="none"><polygon points="3,1 13,7 3,13" stroke={c} strokeWidth="1.4" strokeLinejoin="round" fill="none"/></svg></span>
    case 'url': return <span style={s}><svg width={w} height={h} viewBox="0 0 14 14" fill="none"><path d="M5.5 8.5l3-3" stroke={c} strokeWidth="1.4" strokeLinecap="round"/><path d="M3.5 9.5a2.5 2.5 0 010-3.5l1.5-1.5" stroke={c} strokeWidth="1.4" strokeLinecap="round"/><path d="M9 4.5l1.5-1.5a2.5 2.5 0 010 3.5l-1.5 1.5" stroke={c} strokeWidth="1.4" strokeLinecap="round"/></svg></span>
    case 'checkbox': return <span style={s}><svg width={w} height={h} viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke={c} strokeWidth="1.4"/><path d="M4 7l2 2 4-4" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    default: return <span style={s}><svg width={w} height={h} viewBox="0 0 14 14" fill="none"><path d="M2 4.5h10M2 7.5h7M2 10.5h8.5" stroke={c} strokeWidth="1.6" strokeLinecap="round"/></svg></span>
  }
}

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
  { value: 'button', label: 'Botón', icon: '⚡' },
]

const TAG_COLORS = [
  '#718096', '#e53e3e', '#dd6b20', '#d69e2e',
  '#38a169', '#3182ce', '#805ad5', '#d53f8c',
  '#00C4A0', '#2d3748',
]

interface FieldEditorProps {
  field: Field | null
  fields?: Field[]
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
  fields = [],
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
  const [config, setConfig] = useState<Record<string, unknown>>(
    (field?.config as Record<string, unknown>) ?? {}
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
        config: isButton
          ? { ...config, action: 'webhook' }
          : type === 'person'
          ? { multiple: config.multiple !== 'false' }
          : null,
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
    <>
      <div
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          zIndex: 200, display: 'flex', alignItems: 'flex-start',
          justifyContent: 'center', paddingTop: 60,
        }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 301,
        width: 'min(720px, 62vw)',
        background: '#fff',
        boxShadow: '-6px 0 40px rgba(15,23,42,0.14)',
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
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    }}
                  >
                    <FieldTypeIcon type={ft.value} size={20} />
                    <div style={{ fontSize: 11, color: type === ft.value ? '#00A888' : '#4a5568', fontWeight: 500 }}>{ft.label}</div>
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

            {/* Person config */}
            {type === 'person' && (
              <div style={{ marginBottom: 18, padding: 16, background: '#f7fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <label style={{ ...labelStyle, marginBottom: 12 }}>Configuración del campo persona</label>
                <ToggleRow
                  label="Permite seleccionar múltiples personas"
                  checked={config.multiple !== 'false'}
                  onChange={(v) => setConfig((prev) => ({ ...prev, multiple: String(v) }))}
                />
              </div>
            )}

            {/* Button config */}
            {isButton && (() => {
              const sendAll = config.sendAllFields !== false
              const selectedIds = (config.selectedFieldIds as string[]) ?? []
              const selectableFields = fields.filter(f => f.type !== 'button')
              return (
                <div style={{ marginBottom: 18, padding: 16, background: '#f7fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <label style={{ ...labelStyle, marginBottom: 12 }}>Configuración del webhook</label>

                  {/* URL */}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ ...labelStyle, fontSize: 11 }}>URL del endpoint (POST)</label>
                    <input
                      type="url"
                      value={String(config.webhookUrl ?? '')}
                      onChange={(e) => setConfig((prev) => ({ ...prev, webhookUrl: e.target.value }))}
                      placeholder="https://hooks.ejemplo.com/webhook/..."
                      style={inputStyle}
                    />
                  </div>

                  {/* Log field */}
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ ...labelStyle, fontSize: 11 }}>ID campo de log (opcional)</label>
                    <input
                      type="text"
                      value={String(config.logFieldId ?? '')}
                      onChange={(e) => setConfig((prev) => ({ ...prev, logFieldId: e.target.value }))}
                      placeholder="field_id para registrar ejecuciones"
                      style={inputStyle}
                    />
                    <p style={{ fontSize: 11, color: '#a0aec0', marginTop: 4 }}>
                      Si lo indicas, cada ejecución queda registrada en ese campo de texto.
                    </p>
                  </div>

                  {/* Campos a enviar: toggle */}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ ...labelStyle, fontSize: 11 }}>Campos a enviar en el webhook</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {[
                        { val: true,  label: '📋 Todos los campos' },
                        { val: false, label: '☑ Seleccionar campos' },
                      ].map(({ val, label }) => (
                        <button
                          key={String(val)}
                          type="button"
                          onClick={() => setConfig(prev => ({ ...prev, sendAllFields: val }))}
                          style={{
                            flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                            border: `1.5px solid ${sendAll === val ? '#00C4A0' : '#e2e8f0'}`,
                            background: sendAll === val ? '#E0F7F4' : '#fff',
                            color: sendAll === val ? '#00A888' : '#64748b',
                            cursor: 'pointer', transition: 'all 0.15s',
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Listado de campos cuando se elige "Seleccionar" */}
                  {!sendAll && (
                    <div style={{ marginBottom: 14 }}>
                      <label style={{ ...labelStyle, fontSize: 11 }}>
                        Campos requeridos&nbsp;
                        <span style={{ fontWeight: 400, color: '#94a3b8', textTransform: 'none' }}>
                          ({selectedIds.length} seleccionados)
                        </span>
                      </label>
                      {selectableFields.length === 0 ? (
                        <p style={{ fontSize: 12, color: '#a0aec0' }}>No hay campos disponibles aún.</p>
                      ) : (
                        <div style={{
                          border: '1px solid #e2e8f0', borderRadius: 8,
                          maxHeight: 220, overflowY: 'auto',
                        }}>
                          {selectableFields.map((f, i) => {
                            const checked = selectedIds.includes(f.id)
                            return (
                              <label
                                key={f.id}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 10,
                                  padding: '9px 12px', cursor: 'pointer',
                                  background: checked ? '#f0fdfa' : i % 2 === 0 ? '#fff' : '#fafbfc',
                                  borderBottom: i < selectableFields.length - 1 ? '1px solid #f1f5f9' : 'none',
                                  transition: 'background 0.1s',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...selectedIds, f.id]
                                      : selectedIds.filter(id => id !== f.id)
                                    setConfig(prev => ({ ...prev, selectedFieldIds: next }))
                                  }}
                                  style={{ width: 15, height: 15, accentColor: '#00C4A0', flexShrink: 0 }}
                                />
                                <FieldTypeIcon type={f.type} size={13} />
                                <span style={{ fontSize: 13, color: '#1a202c', fontWeight: checked ? 500 : 400 }}>{f.name}</span>
                                {checked && (
                                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#00A888', fontWeight: 600 }}>REQUERIDO</span>
                                )}
                              </label>
                            )
                          })}
                        </div>
                      )}
                      <p style={{ fontSize: 11, color: '#64748b', marginTop: 6, lineHeight: 1.5 }}>
                        Solo se enviarán estos campos. Si alguno está vacío al ejecutar, se mostrará una alerta.
                      </p>
                    </div>
                  )}

                  {/* Info payload */}
                  <div style={{ padding: '10px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
                    El endpoint recibirá: <code style={{ fontFamily: 'monospace', background: '#fef3c7', padding: '1px 4px', borderRadius: 3 }}>&#123; recordId, data, triggeredBy, triggeredAt &#125;</code>
                  </div>
                </div>
              )
            })()}

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
    </>
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
