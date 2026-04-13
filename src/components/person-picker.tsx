'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface Person {
  name: string
  email: string
  photo: string | null
}

interface PersonPickerProps {
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
  max?: number  // 1 = single person, undefined/Infinity = unlimited
}

const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#14b8a6','#f97316']

// Module-level photo cache: persists across renders in the same session
const photoCache = new Map<string, string | null>()

function avatarColor(str: string): string {
  let h = 0
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0xff
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function Avatar({ photo, name, size = 36 }: { photo?: string | null; name: string; size?: number }) {
  const [error, setError] = useState(false)
  const src = photo ?? photoCache.get(name) ?? null

  if (src && !error) {
    return (
      <img
        src={src}
        alt={name}
        onError={() => setError(true)}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: avatarColor(name),
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.38), fontWeight: 700, color: '#fff',
    }}>
      {(name || '?').charAt(0).toUpperCase()}
    </span>
  )
}

export function PersonPicker({ value, onChange, disabled, max }: PersonPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Person[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [apiError, setApiError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const isSingle = max === 1
  const canAddMore = !max || value.length < max

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setOpen(false); return }
    setLoading(true)
    setApiError(null)
    try {
      const res = await fetch(`/api/people/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      if (!res.ok) {
        setApiError(
          data.error === 'session_expired'
            ? 'Tu sesión de Google expiró. Cierra sesión y vuelve a entrar.'
            : 'No se pudo conectar con el directorio.'
        )
        setResults([])
        setOpen(false)
      } else {
        // Cache photos
        for (const p of data as Person[]) {
          if (p.email) photoCache.set(p.email, p.photo)
          if (p.name) photoCache.set(p.name, p.photo)
        }
        setResults(data)
        setOpen(data.length > 0)
        setActiveIdx(0)
      }
    } catch {
      setApiError('Error de conexión.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(query), 300)
    return () => clearTimeout(timerRef.current)
  }, [query, search])

  function select(person: Person) {
    const label = person.email || person.name
    // Cache photo for this label
    if (person.photo) {
      photoCache.set(person.email, person.photo)
      photoCache.set(person.name, person.photo)
    }
    if (isSingle) {
      onChange([label])
    } else if (!value.includes(label)) {
      onChange([...value, label])
    }
    setQuery('')
    setResults([])
    setOpen(false)
    setApiError(null)
    if (!isSingle) inputRef.current?.focus()
  }

  function remove(label: string) {
    onChange(value.filter((v) => v !== label))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && results[activeIdx]) { e.preventDefault(); select(results[activeIdx]) }
    if (e.key === 'Escape') { setOpen(false) }
  }

  const showInput = !disabled && canAddMore

  return (
    <div>
      {/* Selected people chips */}
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: showInput ? 8 : 0 }}>
          {value.map((label) => {
            const cachedPhoto = photoCache.get(label) ?? null
            const color = avatarColor(label)
            return (
              <span key={label} style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '3px 10px 3px 4px', borderRadius: 20,
                background: color + '15',
                border: `1px solid ${color}35`,
                fontSize: 12, color: '#374151',
              }}>
                <Avatar photo={cachedPhoto} name={label} size={24} />
                <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {label}
                </span>
                {!disabled && (
                  <button type="button" onClick={() => remove(label)} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#94a3b8', fontSize: 15, lineHeight: 1, padding: '0 1px',
                  }}>×</button>
                )}
              </span>
            )
          })}
        </div>
      )}

      {/* Input */}
      {showInput && (
        <div style={{ position: 'relative' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder={isSingle && value.length === 0
              ? 'Busca una persona por nombre o correo...'
              : 'Busca por nombre o correo...'
            }
            style={{
              width: '100%', padding: '8px 34px 8px 12px',
              border: '1px solid #e2e8f0', borderRadius: 8,
              fontSize: 13, outline: 'none', boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
          <span style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            fontSize: 13, pointerEvents: 'none',
          }}>
            {loading
              ? <span style={{ color: '#a0aec0' }}>⏳</span>
              : <span style={{ color: '#cbd5e1' }}>🔍</span>
            }
          </span>

          {/* Error hint */}
          {apiError && (
            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#ef4444' }}>{apiError}</p>
          )}

          {/* Dropdown */}
          {open && results.length > 0 && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
              background: '#fff', borderRadius: 10,
              boxShadow: '0 4px 24px rgba(0,0,0,0.13)', border: '1px solid #e8edf2',
              overflow: 'hidden',
            }}>
              {results.map((person, i) => {
                const alreadySelected = value.includes(person.email || person.name)
                return (
                  <button
                    key={person.email || person.name}
                    type="button"
                    onMouseDown={() => !alreadySelected && select(person)}
                    onMouseEnter={() => setActiveIdx(i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      width: '100%', padding: '10px 14px',
                      background: alreadySelected ? '#f8fafc' : i === activeIdx ? '#f0fdfa' : '#fff',
                      border: 'none',
                      borderBottom: i < results.length - 1 ? '1px solid #f1f5f9' : 'none',
                      cursor: alreadySelected ? 'default' : 'pointer',
                      textAlign: 'left', opacity: alreadySelected ? 0.5 : 1,
                    }}
                  >
                    <Avatar photo={person.photo} name={person.name || person.email} size={38} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a202c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {person.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {person.email}
                      </div>
                    </div>
                    {alreadySelected && (
                      <span style={{ fontSize: 12, color: '#00C4A0', flexShrink: 0 }}>✓</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
