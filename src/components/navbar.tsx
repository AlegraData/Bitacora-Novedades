'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useState, useEffect, useRef } from 'react'
import type { Role } from '@/types'

interface NavbarProps {
  userName: string
  userEmail: string
  userImage?: string | null
  userRole: Role
}

const AlegraLogo = () => (
  <svg viewBox="0 0 60 42" fill="#00C4A0" style={{ width: 40, height: 28 }}>
    <path d="M44.1655 35.523C42.7057 36.262 30.0716 38.8032 20.4654 36.2079C13.2923 34.2614 3.72211 28.6923 0.532056 26.7639C-0.0446777 26.4034 -0.170838 25.6284 0.243689 25.1058L12.0487 10.1467C12.5533 9.51594 13.5446 9.57001 13.9591 10.2549C15.8696 13.2827 20.7177 20.4739 26.467 25.3581C34.1989 31.9184 40.4528 33.7568 44.2016 34.1893C44.6702 34.2434 45.6074 34.7661 44.1655 35.523Z"/>
    <path d="M40.7596 30.3143C39.5701 30.044 31.0273 25.5022 26.7018 19.4104C23.5838 15.0309 20.7902 7.62346 19.7629 4.73979C19.5286 4.09097 19.9252 3.42412 20.592 3.27993L33.8388 0.396268C34.6319 0.216039 35.3528 0.900912 35.2627 1.69392C34.9202 4.57759 34.3975 10.6874 35.3708 15.9861C36.7225 23.4656 39.462 27.5208 41.4265 29.5574C41.6788 29.8097 41.9672 30.5666 40.7777 30.3143H40.7596Z"/>
    <path d="M42.1111 26.8539C41.5704 26.2051 38.7768 20.1494 38.939 14.9948C39.0472 11.4983 40.4349 6.65018 41.1378 4.41534C41.3361 3.76652 42.057 3.46013 42.6878 3.7485L50.3295 7.31703C51.0685 7.65947 51.2307 8.6327 50.672 9.22746C49.1941 10.7955 46.6709 13.6971 45.1209 16.743C42.7419 21.411 42.5436 24.7812 42.7779 26.7277C42.814 26.962 42.6518 27.5027 42.1111 26.8719V26.8539Z"/>
    <path d="M45.2828 24.9437C45.2648 24.4571 46.1299 20.6903 48.0223 18.3833C49.2478 16.9055 51.4286 15.2654 52.6001 14.4363C53.0146 14.148 53.5914 14.2921 53.8257 14.7427L55.8442 18.6357C56.1146 19.1764 55.7721 19.8432 55.1774 19.9333C53.9158 20.1496 51.9152 20.5821 50.2571 21.3751C47.4996 22.6728 46.238 24.1507 45.6613 25.1239C45.5892 25.2501 45.3189 25.4303 45.3008 24.9437H45.2828Z"/>
  </svg>
)

export function Navbar({ userName, userEmail, userImage, userRole }: NavbarProps) {
  const router = useRouter()
  const supabase = createClient()
  
  // States for export dropdown logic
  const [selectedIds, setSelectedIds] = useState<string>('')
  const [exportMenuOpen, setExportMenuOpen] = useState<'csv' | 'xlsx' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const initials = (userName || userEmail).split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()

  useEffect(() => {
    const handleSelectionChange = (e: Event) => {
      const customEvent = e as CustomEvent<string>
      setSelectedIds(customEvent.detail)
    }
    window.addEventListener('bitacora-selection-change', handleSelectionChange)
    return () => window.removeEventListener('bitacora-selection-change', handleSelectionChange)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  function doExport(format: 'csv' | 'xlsx', onlySelected: boolean) {
    const url = `/api/export?format=${format}${onlySelected && selectedIds ? `&ids=${selectedIds}` : ''}`
    window.open(url)
    setExportMenuOpen(null)
  }

  const btnStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.15)',
    color: '#a0aec0',
    padding: '5px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  }

  const count = selectedIds ? selectedIds.split(',').length : 0

  return (
    <nav style={{
      background: '#1e2a3a',
      height: 56,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 20px',
      flexShrink: 0,
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/app" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
          <AlegraLogo />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', lineHeight: 1.2 }}>
              Alegra <span style={{ color: '#00C4A0' }}>·</span> Bitácora
            </div>
            <div style={{ fontSize: 11, color: '#a0aec0' }}>Novedades Product</div>
          </div>
        </Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} ref={menuRef}>
        {userRole === 'ADMIN' && (
          <Link
            href="/admin"
            style={{ ...btnStyle, textDecoration: 'none' }}
          >
            Admin
          </Link>
        )}

        {/* Dropdown export Buttons */}
        {(['csv', 'xlsx'] as const).map((format) => (
          <div key={format} style={{ position: 'relative' }}>
            <button
              onClick={() => {
                if (count > 0) setExportMenuOpen(exportMenuOpen === format ? null : format)
                else doExport(format, false)
              }}
              style={btnStyle}
            >
              Exportar {format === 'csv' ? 'CSV' : 'Excel'}
              {count > 0 && <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>}
            </button>

            {/* Submenu if selected items exist */}
            {exportMenuOpen === format && count > 0 && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4,
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.1)', overflow: 'hidden', minWidth: 160, zIndex: 110,
              }}>
                <button
                  onClick={() => doExport(format, true)}
                  style={{
                    display: 'block', width: '100%', padding: '10px 14px', textAlign: 'left',
                    background: 'none', border: 'none', borderBottom: '1px solid #e2e8f0',
                    cursor: 'pointer', fontSize: 13, color: '#1a202c', fontWeight: 500,
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                >
                  Exportar selección ({count})
                </button>
                <button
                  onClick={() => doExport(format, false)}
                  style={{
                    display: 'block', width: '100%', padding: '10px 14px', textAlign: 'left',
                    background: 'none', border: 'none',
                    cursor: 'pointer', fontSize: 13, color: '#4a5568',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                >
                  Exportar todo
                </button>
              </div>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
          <div style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: '#00C4A0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 600,
            color: '#fff',
            overflow: 'hidden',
            flexShrink: 0,
          }}>
            {userImage
              ? <img src={userImage} alt={userName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : initials
            }
          </div>
          <span style={{ color: '#cbd5e0', fontSize: 13 }}>{userName}</span>
          <button
            onClick={handleSignOut}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#718096',
              cursor: 'pointer',
              fontSize: 12,
              padding: '4px 8px',
            }}
          >
            Salir
          </button>
        </div>
      </div>
    </nav>
  )
}
