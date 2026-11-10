'use client'

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import { Users, Lock, ClipboardList, Plug, KeyRound, Send, Mail, Loader2 } from 'lucide-react'
import type { Field, Role } from '@/types'
import type { ApiKeyDTO } from '@/lib/api/keys'
import { DEFAULT_TAB, TAB_GROUPS, TAB_LABELS, tabFromHash, type AdminTab } from '@/lib/admin/tabs'
import { CommunicationAdmin } from '@/components/email/communication-admin'
import { EmailAdmin } from '@/components/email/email-admin'
import { UsersTab, type AdminUser } from '@/components/admin/users-tab'
import { PermissionsTab } from '@/components/admin/permissions-tab'
import { AuditTab } from '@/components/admin/audit-tab'
import { McpTab } from '@/components/admin/mcp-tab'
import { ApiTab } from '@/components/admin/api-tab'
import { colors } from '@/components/admin/ui'

interface AdminPanelProps {
  fields: Field[]
  users: AdminUser[]
  apiKeys: ApiKeyDTO[]
  currentUserEmail: string
  onUpdateUserRole: (userId: string, role: Role) => Promise<void>
  onSaveFieldPermission: (fieldId: string, role: Role, canEdit: boolean) => Promise<void>
}

const TAB_ICONS: Record<AdminTab, ReactNode> = {
  users: <Users size={15} />,
  permissions: <Lock size={15} />,
  audit: <ClipboardList size={15} />,
  mcp: <Plug size={15} />,
  api: <KeyRound size={15} />,
  communication: <Send size={15} />,
  email: <Mail size={15} />,
}

export function AdminPanel({ fields, users: initialUsers, apiKeys, currentUserEmail, onUpdateUserRole, onSaveFieldPermission }: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>(DEFAULT_TAB)
  const [users, setUsers] = useState<AdminUser[]>(initialUsers)
  const [isPending, startTransition] = useTransition()

  // La pestaña vive en la URL (#audit): se conserva al recargar y se puede compartir el enlace.
  useEffect(() => {
    const read = () => setTab(tabFromHash(window.location.hash))
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])

  function go(next: AdminTab) {
    setTab(next)
    try { window.history.replaceState(null, '', `#${next}`) } catch { /* sin historial: se queda solo en memoria */ }
  }

  function handleRoleChange(userId: string, role: Role) {
    startTransition(async () => {
      await onUpdateUserRole(userId, role)
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)))
    })
  }

  function handlePermissionChange(fieldId: string, role: Role, canEdit: boolean) {
    startTransition(async () => {
      await onSaveFieldPermission(fieldId, role, canEdit)
    })
  }

  return (
    <div style={{ maxWidth: 1360, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: colors.text, margin: 0 }}>Panel de Administración</h1>
          <p style={{ fontSize: 14, color: colors.muted, margin: '4px 0 0' }}>Usuarios, permisos, auditoría, agentes de IA, API y comunicación de novedades.</p>
        </div>
        <span
          role="status"
          aria-live="polite"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, background: colors.tealSoft, color: colors.tealDark, visibility: isPending ? 'visible' : 'hidden' }}
        >
          <Loader2 size={14} className="animate-spin" /> Guardando cambios…
        </span>
      </div>

      <nav aria-label="Secciones de administración" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        {TAB_GROUPS.map((group) => (
          <div key={group.label} style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: '8px 8px 6px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.faint, padding: '0 8px 6px' }}>{group.label}</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {group.tabs.map((key) => {
                const active = tab === key
                return (
                  <button
                    key={key}
                    onClick={() => go(key)}
                    aria-current={active ? 'page' : undefined}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                      background: active ? colors.navy : 'transparent', color: active ? '#fff' : colors.muted,
                    }}
                  >
                    {TAB_ICONS[key]} {TAB_LABELS[key]}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {tab === 'users' && <UsersTab users={users} onRoleChange={handleRoleChange} />}
      {tab === 'permissions' && <PermissionsTab fields={fields} onChange={handlePermissionChange} />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'mcp' && <McpTab />}
      {tab === 'api' && <ApiTab apiKeys={apiKeys} currentUserEmail={currentUserEmail} />}
      {tab === 'communication' && <CommunicationAdmin />}
      {tab === 'email' && <EmailAdmin />}
    </div>
  )
}

