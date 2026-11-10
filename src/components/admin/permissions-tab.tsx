'use client'

import { useMemo, useState } from 'react'
import type { Field, Role } from '@/types'
import { DataTable, FilterSelect, SectionHeader, type Column } from './ui'
import { ROLES, ROLE_COLORS } from './users-tab'

const TYPE_LABELS: Record<string, string> = {
  text: 'Texto', number: 'Número', date: 'Fecha', select: 'Selección', multiselect: 'Selección múltiple',
  person: 'Persona', url: 'Enlace', checkbox: 'Casilla', button: 'Botón',
}

export function PermissionsTab({ fields, onChange }: { fields: Field[]; onChange: (fieldId: string, role: Role, canEdit: boolean) => void }) {
  const [type, setType] = useState('')
  // Optimista: la casilla responde al instante aunque el guardado tarde.
  const [local, setLocal] = useState<Record<string, boolean>>({})

  const editable = useMemo(() => fields.filter((f) => f.type !== 'button'), [fields])
  const types = useMemo(() => [...new Set(editable.map((f) => f.type))].sort(), [editable])
  const rows = useMemo(() => (type ? editable.filter((f) => f.type === type) : editable), [editable, type])

  function canEdit(field: Field, role: Role): boolean {
    const key = `${field.id}:${role}`
    if (key in local) return local[key]
    const perm = field.permissions.find((p) => p.role === role)
    return perm ? perm.canEdit : role === 'ADMIN' || role === 'MANAGER'
  }

  const columns: Column<Field>[] = [
    { key: 'name', header: 'Campo', render: (f) => <span style={{ fontSize: 14, fontWeight: 500 }}>{f.name}</span> },
    { key: 'type', header: 'Tipo', render: (f) => <span style={{ fontSize: 12, color: '#718096' }}>{TYPE_LABELS[f.type] ?? f.type}</span> },
    ...ROLES.map((role) => ({
      key: role,
      align: 'center' as const,
      header: <span style={{ color: ROLE_COLORS[role] }}>{role}</span>,
      render: (f: Field) => (
        <input
          type="checkbox"
          checked={canEdit(f, role)}
          aria-label={`${role} puede editar ${f.name}`}
          onChange={(e) => {
            setLocal((l) => ({ ...l, [`${f.id}:${role}`]: e.target.checked }))
            onChange(f.id, role, e.target.checked)
          }}
          style={{ width: 18, height: 18, accentColor: '#00C4A0', cursor: 'pointer' }}
        />
      ),
    })),
  ]

  return (
    <div>
      <SectionHeader
        title="Permisos de campos"
        description="Marca qué roles pueden editar cada campo. Sin permiso definido aplica el valor por defecto: ADMIN y MANAGER editan, VIEWER solo consulta. El cambio se guarda al marcar la casilla."
      />
      <DataTable
        columns={columns}
        rows={rows}
        getKey={(f) => f.id}
        searchText={(f) => [f.name, TYPE_LABELS[f.type] ?? f.type, f.type]}
        searchPlaceholder="Buscar campo…"
        empty="No hay campos configurados aún."
        toolbar={
          <FilterSelect
            label="Filtrar por tipo de campo"
            value={type}
            onChange={setType}
            options={[{ value: '', label: 'Todos los tipos' }, ...types.map((t) => ({ value: t, label: TYPE_LABELS[t] ?? t }))]}
          />
        }
      />
    </div>
  )
}
