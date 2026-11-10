import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Todas las acciones del panel (incluidas las de reglas, pendientes y reejecución) deben exigir ADMIN.
test('cada server action de email-admin exige ADMIN antes de hacer nada', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/actions/email-admin.ts'), 'utf8')
  const bodies = src.split(/\nexport async function /).slice(1)
  assert.ok(bodies.length >= 20, 'se esperaban las acciones del panel')
  for (const body of bodies) {
    const name = body.slice(0, body.indexOf('('))
    assert.match(body.slice(0, body.indexOf('\n}\n')), /requireAdmin\(\)|await admin\(\)/, `${name} no exige ADMIN`)
  }
})

test('la pestaña «Comunicación» está en el panel de administrador (que solo abre un ADMIN)', () => {
  const panel = readFileSync(join(process.cwd(), 'src/components/admin-panel.tsx'), 'utf8')
  assert.match(panel, /\['communication', '📨 Comunicación'\]/)
  assert.match(panel, /tab === 'communication' && <CommunicationAdmin \/>/)
  const page = readFileSync(join(process.cwd(), 'src/app/admin/page.tsx'), 'utf8')
  assert.match(page, /role !== 'ADMIN'\) redirect\('\/app'\)/)
})
