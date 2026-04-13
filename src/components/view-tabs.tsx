'use client'

import { useState, useRef, useEffect } from 'react'
import type { View } from '@/types'

const EMOJI_OPTIONS = ['📋', '📊', '🔍', '🎯', '⭐', '🔖', '📌', '🏷️', '✅', '🗂️', '📁', '💼', '🚀', '🔔', '📝']
const GENERAL_VIEW_ID = '__general__'

interface ViewTabsProps {
  views: View[]
  activeViewId: string
  onSwitch: (viewId: string) => void
  onCreate: (name: string, emoji: string) => void
  onUpdate: (id: string, name: string, emoji: string) => void
  onDelete: (id: string) => void
}

export function ViewTabs({ views, activeViewId, onSwitch, onCreate, onUpdate, onDelete }: ViewTabsProps) {
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmoji, setNewEmoji] = useState('📋')
  const [showNewEmojiPicker, setShowNewEmojiPicker] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingEmoji, setEditingEmoji] = useState('📋')
  const [showEditEmojiPicker, setShowEditEmojiPicker] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const newInputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  function openMenu(viewId: string) {
    const el = tabRefs.current.get(viewId)
    if (el) {
      const rect = el.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 2, left: rect.left })
    }
    setOpenMenuId(viewId)
  }

  useEffect(() => {
    if (!openMenuId) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null)
        setMenuPos(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openMenuId])

  useEffect(() => {
    if (isCreating) newInputRef.current?.focus()
  }, [isCreating])

  useEffect(() => {
    if (editingId) editInputRef.current?.focus()
  }, [editingId])

  function startEdit(view: View) {
    setOpenMenuId(null)
    setMenuPos(null)
    setEditingId(view.id)
    setEditingName(view.name)
    setEditingEmoji(view.emoji)
    setShowEditEmojiPicker(false)
  }

  function confirmEdit() {
    if (!editingId || !editingName.trim()) return
    onUpdate(editingId, editingName.trim(), editingEmoji)
    setEditingId(null)
  }

  function confirmCreate() {
    if (!newName.trim()) return
    onCreate(newName.trim(), newEmoji)
    setIsCreating(false)
    setNewName('')
    setNewEmoji('📋')
    setShowNewEmojiPicker(false)
  }

  function cancelCreate() {
    setIsCreating(false)
    setNewName('')
    setNewEmoji('📋')
    setShowNewEmojiPicker(false)
  }

  const tabBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', borderRadius: '6px 6px 0 0',
    fontSize: 13, fontWeight: 500, cursor: 'pointer',
    borderTop: '2px solid transparent',
    borderLeft: '1px solid transparent',
    borderRight: '1px solid transparent',
    borderBottom: 'none',
    whiteSpace: 'nowrap', transition: 'background 0.1s',
    background: 'transparent', color: '#64748b',
  }

  const tabActive: React.CSSProperties = {
    ...tabBase,
    background: '#fff',
    color: '#0f172a',
    borderTop: '2px solid #00C4A0',
    borderLeft: '1px solid #e2e8f0',
    borderRight: '1px solid #e2e8f0',
    fontWeight: 600,
    boxShadow: '0 -2px 6px rgba(0,0,0,0.04)',
  }

  return (
    <div style={{
      background: '#f1f5f9',
      borderBottom: '2px solid #e2e8f0',
      display: 'flex', alignItems: 'flex-end',
      padding: '8px 20px 0', gap: 2, flexShrink: 0,
      overflowX: 'auto',
    }}>
      {/* General tab */}
      <button
        onClick={() => onSwitch(GENERAL_VIEW_ID)}
        style={activeViewId === GENERAL_VIEW_ID ? tabActive : tabBase}
        onMouseEnter={(e) => {
          if (activeViewId !== GENERAL_VIEW_ID)
            (e.currentTarget as HTMLButtonElement).style.background = '#f1f5f9'
        }}
        onMouseLeave={(e) => {
          if (activeViewId !== GENERAL_VIEW_ID)
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
        }}
      >
        📋 General
      </button>

      {/* Custom views */}
      {views.map((view) => {
        const isActive = activeViewId === view.id
        const isEditing = editingId === view.id

        if (isEditing) {
          return (
            <div key={view.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 8px', background: '#f8fafc',
              border: '1px solid #e2e8f0', borderRadius: '6px 6px 0 0',
              borderBottom: 'none', position: 'relative',
            }}>
              {/* Emoji button */}
              <button type="button" onClick={() => setShowEditEmojiPicker(v => !v)} style={{
                background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '0 2px',
              }}>{editingEmoji}</button>

              {showEditEmojiPicker && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, zIndex: 500,
                  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.12)', padding: 8,
                  display: 'flex', flexWrap: 'wrap', gap: 2, width: 200,
                }}>
                  {EMOJI_OPTIONS.map(e => (
                    <button key={e} type="button" onClick={() => { setEditingEmoji(e); setShowEditEmojiPicker(false) }} style={{
                      background: editingEmoji === e ? '#e0e7ff' : 'none',
                      border: 'none', cursor: 'pointer', fontSize: 18,
                      borderRadius: 4, padding: '3px 5px',
                    }}>{e}</button>
                  ))}
                </div>
              )}

              <input
                ref={editInputRef}
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') setEditingId(null) }}
                style={{
                  border: 'none', outline: 'none', fontSize: 13,
                  background: 'transparent', width: 100, color: '#1a202c',
                }}
              />
              <button type="button" onClick={confirmEdit} style={{
                background: '#00C4A0', color: '#fff', border: 'none',
                borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '2px 8px',
              }}>OK</button>
              <button type="button" onClick={() => setEditingId(null)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#94a3b8', fontSize: 15, padding: '0 2px',
              }}>×</button>
            </div>
          )
        }

        return (
          <div
            key={view.id}
            ref={(el) => { if (el) tabRefs.current.set(view.id, el); else tabRefs.current.delete(view.id) }}
            style={{ position: 'relative' }}
            onMouseEnter={() => setHoveredTabId(view.id)}
            onMouseLeave={() => setHoveredTabId(null)}
          >
            <button
              onClick={() => onSwitch(view.id)}
              style={isActive ? tabActive : {
                ...tabBase,
                background: hoveredTabId === view.id ? '#e2e8f0' : 'transparent',
              }}
            >
              {view.emoji} {view.name}

              {/* ··· menu button — visible en hover o cuando está activa */}
              {(hoveredTabId === view.id || isActive) && (
                <span
                  onClick={(e) => { e.stopPropagation(); openMenu(view.id) }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 18, height: 18, borderRadius: 3,
                    background: openMenuId === view.id ? '#e2e8f0' : 'transparent',
                    color: isActive ? '#475569' : '#64748b',
                    fontSize: 13, marginLeft: 2, fontWeight: 700,
                  }}
                >···</span>
              )}
            </button>

            {/* Dropdown — renderizado fuera del overflow via fixed */}
            {openMenuId === view.id && menuPos && (
              <div ref={menuRef} style={{
                position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999,
                background: '#fff', border: '1px solid #e2e8f0',
                borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                minWidth: 160, padding: '4px 0',
              }}>
                <button type="button" onClick={() => startEdit(view)} style={{
                  display: 'block', width: '100%', padding: '8px 14px',
                  fontSize: 13, color: '#374151', background: 'none',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >✏️ Renombrar</button>
                <button type="button" onClick={() => { setOpenMenuId(null); setMenuPos(null); onDelete(view.id) }} style={{
                  display: 'block', width: '100%', padding: '8px 14px',
                  fontSize: 13, color: '#ef4444', background: 'none',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#fff5f5')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >🗑️ Eliminar</button>
              </div>
            )}
          </div>
        )
      })}

      {/* New view — inline form */}
      {isCreating ? (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', background: '#f8fafc',
          border: '1px solid #e2e8f0', borderRadius: '6px 6px 0 0',
          borderBottom: 'none', position: 'relative',
        }}>
          <button type="button" onClick={() => setShowNewEmojiPicker(v => !v)} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '0 2px',
          }}>{newEmoji}</button>

          {showNewEmojiPicker && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 500,
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)', padding: 8,
              display: 'flex', flexWrap: 'wrap', gap: 2, width: 200,
            }}>
              {EMOJI_OPTIONS.map(e => (
                <button key={e} type="button" onClick={() => { setNewEmoji(e); setShowNewEmojiPicker(false) }} style={{
                  background: newEmoji === e ? '#e0e7ff' : 'none',
                  border: 'none', cursor: 'pointer', fontSize: 18,
                  borderRadius: 4, padding: '3px 5px',
                }}>{e}</button>
              ))}
            </div>
          )}

          <input
            ref={newInputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmCreate(); if (e.key === 'Escape') cancelCreate() }}
            placeholder="Nombre de la vista"
            style={{
              border: 'none', outline: 'none', fontSize: 13,
              background: 'transparent', width: 130, color: '#1a202c',
            }}
          />
          <button type="button" onClick={confirmCreate} style={{
            background: '#00C4A0', color: '#fff', border: 'none',
            borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '2px 8px',
          }}>Crear</button>
          <button type="button" onClick={cancelCreate} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#94a3b8', fontSize: 15, padding: '0 2px',
          }}>×</button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          title="Nueva vista"
          style={{
            background: 'none', border: 'none', color: '#94a3b8',
            fontSize: 20, cursor: 'pointer', padding: '4px 8px',
            borderRadius: 6, lineHeight: 1,
          }}
        >+</button>
      )}
    </div>
  )
}
