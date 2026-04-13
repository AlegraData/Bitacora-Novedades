'use client'

import { useState, useTransition } from 'react'
import type { Field, AuditLog, Role } from '@/types'

interface DBUser {
  id: string
  email: string
  name: string
  image: string | null
  role: Role
  createdAt: string
  updatedAt: string
}

interface AdminPanelProps {
  fields: Field[]
  users: DBUser[]
  auditLogs: AuditLog[]
  onUpdateUserRole: (userId: string, role: Role) => Promise<void>
  onSaveFieldPermission: (fieldId: string, role: Role, canEdit: boolean) => Promise<void>
}

type Tab = 'users' | 'permissions' | 'audit'

export function AdminPanel({ fields, users: initialUsers, auditLogs, onUpdateUserRole, onSaveFieldPermission }: AdminPanelProps) {
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

  const ROLES: Role[] = ['ADMIN', 'MANAGER', 'VIEWER']
  const ROLE_COLORS: Record<Role, string> = {
    ADMIN: '#e53e3e',
    MANAGER: '#3182ce',
    VIEWER: '#718096',
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a202c' }}>Panel de Administración</h1>
        <p style={{ fontSize: 14, color: '#718096', marginTop: 4 }}>Gestión de usuarios, permisos y auditoría</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#fff', padding: 4, borderRadius: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', width: 'fit-content' }}>
        {([['users', '👥 Usuarios'], ['permissions', '🔐 Permisos de campos'], ['audit', '📋 Auditoría']] as [Tab, string][]).map(([key, label]) => (
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
      {tab === 'users' && (
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#1e2a3a' }}>
                {['Usuario', 'Email', 'Rol', 'Miembro desde'].map((h) => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#a0aec0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid #f0f4f8' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: '#00C4A0', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden',
                      }}>
                        {u.image
                          ? <img src={u.image} alt={u.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : u.name.charAt(0).toUpperCase()
                        }
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 500, color: '#1a202c' }}>{u.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#718096' }}>{u.email}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value as Role)}
                      style={{
                        padding: '5px 10px',
                        border: `1.5px solid ${ROLE_COLORS[u.role]}`,
                        borderRadius: 20,
                        fontSize: 12, fontWeight: 600,
                        color: ROLE_COLORS[u.role],
                        background: '#fff',
                        cursor: 'pointer',
                        outline: 'none',
                      }}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#718096' }}>
                    {new Date(u.createdAt).toLocaleDateString('es-CO')}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: '#a0aec0' }}>
                    No hay usuarios registrados aún.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Permissions tab */}
      {tab === 'permissions' && (
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
            <p style={{ fontSize: 13, color: '#718096' }}>
              Controla qué roles pueden editar cada campo. Si no hay permiso definido, el comportamiento por defecto aplica (ADMIN y MANAGER pueden editar, VIEWER solo visualiza).
            </p>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#1e2a3a' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#a0aec0' }}>Campo</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#a0aec0' }}>Tipo</th>
                {ROLES.map((r) => (
                  <th key={r} style={{ padding: '10px 16px', textAlign: 'center', fontSize: 12, fontWeight: 600, color: ROLE_COLORS[r] }}>{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fields.filter(f => f.type !== 'button').map((field) => (
                <tr key={field.id} style={{ borderBottom: '1px solid #f0f4f8' }}>
                  <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 500, color: '#1a202c' }}>{field.name}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#718096' }}>{field.type}</td>
                  {ROLES.map((role) => {
                    const perm = field.permissions.find((p) => p.role === role)
                    const canEdit = perm ? perm.canEdit : (role === 'ADMIN' || role === 'MANAGER')
                    return (
                      <td key={role} style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={canEdit}
                          onChange={(e) => handlePermissionChange(field.id, role, e.target.checked)}
                          style={{ width: 18, height: 18, accentColor: '#00C4A0', cursor: 'pointer' }}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
              {fields.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: '#a0aec0' }}>
                    No hay campos configurados aún.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Audit tab */}
      {tab === 'audit' && (
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#1e2a3a' }}>
                {['Fecha', 'Usuario', 'Acción', 'Registro ID'].map((h) => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#a0aec0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid #f0f4f8' }}>
                  <td style={{ padding: '10px 16px', fontSize: 12, color: '#718096', whiteSpace: 'nowrap' }}>
                    {new Date(log.timestamp).toLocaleString('es-CO')}
                  </td>
                  <td style={{ padding: '10px 16px', fontSize: 13 }}>
                    <div style={{ fontWeight: 500, color: '#1a202c' }}>{log.userName}</div>
                    <div style={{ fontSize: 11, color: '#a0aec0' }}>{log.userEmail}</div>
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{
                      padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: log.action.includes('CREATED') ? '#c6f6d5' : log.action.includes('DELETED') ? '#fed7d7' : '#bee3f8',
                      color: log.action.includes('CREATED') ? '#276749' : log.action.includes('DELETED') ? '#9b2c2c' : '#2c5282',
                    }}>
                      {log.action}
                    </span>
                  </td>
                  <td style={{ padding: '10px 16px', fontSize: 11, color: '#a0aec0', fontFamily: 'monospace' }}>
                    {log.recordId ?? '—'}
                  </td>
                </tr>
              ))}
              {auditLogs.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: '#a0aec0' }}>
                    Sin registros de auditoría.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
