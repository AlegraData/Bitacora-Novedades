'use client'

import { useState, useTransition } from 'react'
import type { Field, Role } from '@/types'
import type { ApiKeyDTO } from '@/lib/api/keys'
import { ApiKeysManager } from '@/components/api-keys/api-keys-manager'
import { CommunicationAdmin } from '@/components/email/communication-admin'
import { EmailAdmin } from '@/components/email/email-admin'
import { UsersTab, type AdminUser } from '@/components/admin/users-tab'
import { PermissionsTab } from '@/components/admin/permissions-tab'
import { AuditTab } from '@/components/admin/audit-tab'
import { McpTab } from '@/components/admin/mcp-tab'

type DBUser = AdminUser

interface AdminPanelProps {
  fields: Field[]
  users: DBUser[]
  apiKeys: ApiKeyDTO[]
  currentUserEmail: string
  onUpdateUserRole: (userId: string, role: Role) => Promise<void>
  onSaveFieldPermission: (fieldId: string, role: Role, canEdit: boolean) => Promise<void>
}

type Tab = 'users' | 'permissions' | 'audit' | 'mcp' | 'api' | 'email' | 'communication'

export function AdminPanel({ fields, users: initialUsers, apiKeys, currentUserEmail, onUpdateUserRole, onSaveFieldPermission }: AdminPanelProps) {
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<DBUser[]>(initialUsers)
  const [isPending, startTransition] = useTransition()

  function handleRoleChange(userId: string, role: Role) {
    startTransition(async () => {
      await onUpdateUserRole(userId, role)
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role } : u))
    })
  }

  function handlePermissionChange(fieldId: string, role: Role, canEdit: boolean) {
    startTransition(async () => {
      await onSaveFieldPermission(fieldId, role, canEdit)
    })
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a202c' }}>Panel de Administración</h1>
        <p style={{ fontSize: 14, color: '#718096', marginTop: 4 }}>Gestión de usuarios, permisos, auditoría y accesos de agentes y API</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#fff', padding: 4, borderRadius: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', width: 'fit-content' }}>
        {([['users', '👥 Usuarios'], ['permissions', '🔐 Permisos de campos'], ['audit', '📋 Auditoría'], ['mcp', '🔌 Conexiones MCP'], ['api', '🔑 API Tokens'], ['email', '✉️ Correos'], ['communication', '📨 Comunicación']] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: 500,
              background: tab === key ? '#1e2a3a' : 'transparent',
              color: tab === key ? '#fff' : '#718096',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {isPending && (
        <div style={{ padding: '8px 14px', background: '#E0F7F4', borderRadius: 8, marginBottom: 16, fontSize: 13, color: '#00A888' }}>
          Guardando cambios...
        </div>
      )}

      {/* Users tab */}
      {tab === 'users' && <UsersTab users={users} onRoleChange={handleRoleChange} />}

      {/* Permissions tab */}
      {tab === 'permissions' && <PermissionsTab fields={fields} onChange={handlePermissionChange} />}

      {/* Audit tab */}
      {tab === 'audit' && <AuditTab />}

      {/* MCP connections tab */}
      {tab === 'mcp' && <McpTab />}

      {/* Email tab */}
      {tab === 'email' && <EmailAdmin />}

      {/* Communication rules tab */}
      {tab === 'communication' && <CommunicationAdmin />}

      {/* API tokens tab */}
      {tab === 'api' && (
        <div>
          <p style={{ fontSize: 13, color: '#718096', marginBottom: 12 }}>
            Tokens de la API REST (<code>/api/v1</code>) de toda la organización. Cada token actúa con el rol de su dueño y limitado a sus permisos (scopes).
            Revocar corta el acceso de inmediato. Cada usuario puede tener máximo 3 tokens activos y crear los suyos en <a href="/api-tokens" style={{ color: '#00A888' }}>/api-tokens</a>.
          </p>
          <ApiKeysManager initialKeys={apiKeys} mode="admin" isAdmin currentUserEmail={currentUserEmail} />
        </div>
      )}
    </div>
  )
}
