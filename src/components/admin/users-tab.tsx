'use client'

import { useMemo, useState } from 'react'
import type { Role } from '@/types'
import { DataTable, FilterSelect, PersonCell, SectionHeader, StatCard, StatGrid, type Column } from './ui'

export interface AdminUser {
  id: string
  email: string
  name: string
  image: string | null
  role: Role
  createdAt: string
  updatedAt: string
}

export const ROLES: Role[] = ['ADMIN', 'MANAGER', 'VIEWER']
export const ROLE_COLORS: Record<Role, string> = { ADMIN: '#e53e3e', MANAGER: '#3182ce', VIEWER: '#718096' }
const ROLE_HELP: Record<Role, string> = {
  ADMIN: 'Todo: usuarios, permisos, API, MCP, correos y reglas de comunicación.',
  MANAGER: 'Crea y edita novedades y campos.',
  VIEWER: 'Solo consulta.',
}

export function UsersTab({ users, onRoleChange }: { users: AdminUser[]; onRoleChange: (userId: string, role: Role) => void }) {
  const [role, setRole] = useState('')
  const counts = useMemo(() => Object.fromEntries(ROLES.map((r) => [r, users.filter((u) => u.role === r).length])) as Record<Role, number>, [users])
  const rows = useMemo(() => (role ? users.filter((u) => u.role === role) : users), [users, role])

  const columns: Column<AdminUser>[] = [
    { key: 'user', header: 'Usuario', render: (u) => <PersonCell name={u.name} email={u.email} image={u.image} />, width: '34%' },
    { key: 'email', header: 'Email', render: (u) => <span style={{ fontSize: 13, color: '#718096' }}>{u.email}</span> },
    {
      key: 'role',
      header: 'Rol',
      render: (u) => (
        <select
          value={u.role}
          onChange={(e) => onRoleChange(u.id, e.target.value as Role)}
          aria-label={`Rol de ${u.name}`}
          style={{ padding: '5px 10px', border: `1.5px solid ${ROLE_COLORS[u.role]}`, borderRadius: 20, fontSize: 12, fontWeight: 600, color: ROLE_COLORS[u.role], background: '#fff', cursor: 'pointer', outline: 'none' }}
        >
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      ),
    },
    { key: 'since', header: 'Miembro desde', nowrap: true, render: (u) => <span style={{ fontSize: 13, color: '#718096' }}>{new Date(u.createdAt).toLocaleDateString('es-CO')}</span> },
  ]

  return (
    <div>
      <SectionHeader title="Usuarios" description="Quién puede entrar a la Bitácora y con qué rol. Quien inicia sesión por primera vez queda como VIEWER; aquí se le sube de rol." />
      <StatGrid>
        <StatCard label="Usuarios" value={users.length} />
        {ROLES.map((r) => <StatCard key={r} label={r} value={counts[r]} hint={ROLE_HELP[r]} />)}
      </StatGrid>
      <DataTable
        columns={columns}
        rows={rows}
        getKey={(u) => u.id}
        searchText={(u) => [u.name, u.email, u.role]}
        searchPlaceholder="Buscar por nombre o correo…"
        empty="No hay usuarios registrados aún."
        toolbar={
          <FilterSelect
            label="Filtrar por rol"
            value={role}
            onChange={setRole}
            options={[{ value: '', label: 'Todos los roles' }, ...ROLES.map((r) => ({ value: r, label: r }))]}
          />
        }
      />
    </div>
  )
}
