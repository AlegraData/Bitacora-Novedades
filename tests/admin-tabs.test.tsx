import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_TABS, DEFAULT_TAB, TAB_GROUPS, TAB_LABELS, tabFromHash } from '@/lib/admin/tabs'

test('tabFromHash: lee #audit y #tab=audit; lo desconocido vuelve a Usuarios', () => {
  assert.equal(tabFromHash('#audit'), 'audit')
  assert.equal(tabFromHash('#tab=mcp'), 'mcp')
  assert.equal(tabFromHash('api'), 'api')
  for (const bad of ['', '#', '#inventada', '#__proto__', null, undefined]) assert.equal(tabFromHash(bad), DEFAULT_TAB, String(bad))
})

test('toda pestaña tiene nombre y pertenece a exactamente un grupo; «Comunicación» está', () => {
  const grouped = TAB_GROUPS.flatMap((g) => g.tabs)
  assert.deepEqual([...grouped].sort(), [...ADMIN_TABS].sort())
  assert.equal(new Set(grouped).size, grouped.length)
  for (const t of ADMIN_TABS) assert.ok(TAB_LABELS[t], t)
  assert.equal(TAB_LABELS.communication, 'Comunicación')
})
