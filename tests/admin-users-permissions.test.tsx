import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString as render } from 'react-dom/server'
import { UsersTab, type AdminUser } from '@/components/admin/users-tab'
import { PermissionsTab } from '@/components/admin/permissions-tab'
import type { Field } from '@/types'

const html = (el: Parameters<typeof render>[0]) => render(el).replace(/<!-- -->/g, '')

const users: AdminUser[] = Array.from({ length: 23 }, (_, i) => ({
  id: `u${i + 1}`, email: `persona${i + 1}@alegra.com`, name: `Persona ${i + 1}`, image: null,
  role: i === 0 ? 'ADMIN' : i < 4 ? 'MANAGER' : 'VIEWER', createdAt: '2026-05-01T10:00:00.000Z', updatedAt: '2026-05-01T10:00:00.000Z',
}))

test('Usuarios: tabla de 10 por página con buscador, filtro por rol y conteo por rol', () => {
  const h = html(<UsersTab users={users} onRoleChange={() => {}} />)
  assert.ok(h.includes('Persona 10') && !h.includes('Persona 11'), 'solo la primera página')
  assert.ok(h.includes('1–10 de 23'))
  assert.ok(h.includes('Buscar por nombre o correo'))
  assert.ok(h.includes('aria-label="Filtrar por rol"'))
  assert.ok(h.includes('aria-label="Rol de Persona 1"'))
  // contadores: 1 ADMIN, 3 MANAGER, 19 VIEWER
  for (const n of ['23', '19']) assert.ok(h.includes(`>${n}<`), `contador ${n}`)
})

const field = (i: number, type = 'text'): Field => ({
  id: `f${i}`, name: `Campo ${i}`, type, order: i, isFilterable: true, isVisible: true, config: null, options: [],
  permissions: i === 1 ? [{ id: 'p1', fieldId: 'f1', role: 'MANAGER', canEdit: false }] : [],
} as unknown as Field)

test('Permisos de campos: paginados, sin los botones, con valores por defecto y permisos guardados', () => {
  const fields = [...Array.from({ length: 14 }, (_, i) => field(i + 1)), field(99, 'button')]
  const h = html(<PermissionsTab fields={fields} onChange={() => {}} />)
  assert.ok(h.includes('Campo 10') && !h.includes('Campo 11'))
  assert.ok(h.includes('1–10 de 14'), 'el campo botón no cuenta')
  assert.ok(!h.includes('Campo 99'))
  assert.ok(h.includes('aria-label="Filtrar por tipo de campo"'))
  // Campo 1: MANAGER sin permiso explícito de edición (guardado en false) → casilla sin marcar; ADMIN por defecto marcado
  const manager = /aria-label="MANAGER puede editar Campo 1"[^>]*>/.exec(h)?.[0] ?? ''
  const admin = /aria-label="ADMIN puede editar Campo 1"[^>]*>/.exec(h)?.[0] ?? ''
  assert.ok(!/checked/.test(manager), manager)
  assert.ok(/checked/.test(admin), admin)
})
