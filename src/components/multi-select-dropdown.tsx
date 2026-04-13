'use client'

import { useState, useRef, useEffect } from 'react'

interface Option {
  id: string
  name: string
  color: string
}

interface MultiSelectDropdownProps {
  options: Option[]
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}

export function MultiSelectDropdown({ options, value, onChange, disabled }: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function toggle(name: string) {
    const next = value.includes(name)
      ? value.filter((v) => v !== name)
      : [...value, name]
    onChange(next)
  }

  function removeTag(name: string, e: React.MouseEvent) {
    e.stopPropagation()
    onChange(value.filter((v) => v !== name))
  }

  const filtered = options.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase())
  )

  // Separate selected and unselected in dropdown
  const selected = filtered.filter((o) => value.includes(o.name))
  const unselected = filtered.filter((o) => !value.includes(o.name))
  const ordered = [...selected, ...unselected]

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Trigger */}
      <div
        onClick={() => { if (!disabled) setOpen((v) => !v) }}
        style={{
          minHeight: 38,
          padding: '5px 8px',
          border: `1px solid ${open ? '#94a3b8' : '#e2e8f0'}`,
          borderRadius: 8,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          alignItems: 'center',
          cursor: disabled ? 'default' : 'pointer',
          background: '#fff',
          transition: 'border-color 0.15s',
        }}
      >
        {value.length === 0 && (
          <span style={{ color: '#a0aec0', fontSize: 13, padding: '1px 4px' }}>
            {disabled ? 'Sin selección' : 'Seleccionar...'}
          </span>
        )}
        {value.map((name) => {
          const opt = options.find((o) => o.name === name)
          const color = opt?.color ?? '#94a3b8'
          return (
            <span
              key={name}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 20,
                background: color + '28',
                border: `1.5px solid ${color}`,
                color: '#1a202c',
                fontSize: 12,
                fontWeight: 500,
                maxWidth: 220,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {name}
              {!disabled && (
                <span
                  onClick={(e) => removeTag(name, e)}
                  style={{ cursor: 'pointer', color: '#718096', fontSize: 14, lineHeight: 1 }}
                >
                  ×
                </span>
              )}
            </span>
          )
        })}
        {!disabled && (
          <span style={{ color: '#cbd5e0', fontSize: 18, lineHeight: 1, marginLeft: 2 }}>+</span>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 1000,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            overflow: 'hidden',
          }}
        >
          {/* Search */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              style={{
                width: '100%',
                border: 'none',
                outline: 'none',
                fontSize: 13,
                color: '#1a202c',
                background: 'transparent',
              }}
            />
          </div>

          {/* Options */}
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {ordered.length === 0 && (
              <div style={{ padding: '10px 14px', color: '#a0aec0', fontSize: 13 }}>
                Sin resultados
              </div>
            )}
            {ordered.map((opt) => {
              const isSelected = value.includes(opt.name)
              return (
                <div
                  key={opt.id}
                  onClick={() => toggle(opt.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '7px 12px',
                    cursor: 'pointer',
                    background: isSelected ? '#f8fafc' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = '#f8fafc'
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'
                  }}
                >
                  {/* Checkbox */}
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      border: `2px solid ${isSelected ? opt.color : '#cbd5e0'}`,
                      background: isSelected ? opt.color : '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      transition: 'all 0.15s',
                    }}
                  >
                    {isSelected && (
                      <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                        <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </span>

                  {/* Color dot + label */}
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '2px 8px',
                      borderRadius: 20,
                      background: opt.color + '22',
                      border: `1.5px solid ${opt.color}`,
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#1a202c',
                    }}
                  >
                    {opt.name}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
