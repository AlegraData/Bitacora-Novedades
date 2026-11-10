import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { loadRules, saveRule, getRulesState } from '@/lib/email/rules'
import { findRule, DEFAULT_REQUIRED_FIELDS } from '@/lib/email/communication'
import { EmailSendError } from '@/lib/email/errors'
import { resetDb, ensureFields, makeUser } from './helpers'

const actor = { id: '', email: 'tomas.lopera@alegra.com', name: 'Tomas' }

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  actor.id = (await makeUser('tomas.lopera@alegra.com', 'ADMIN')).id
})

async function rejects(p: Promise<unknown>, re: RegExp) {
  await assert.rejects(p, (e: unknown) => e instanceof EmailSendError && re.test(e.info.message))
}

test('sin filas: rigen los valores de fábrica (Novedad y Pre-novedad en AUTO, el resto sin regla)', async () => {
  const rules = await loadRules()
  assert.equal(findRule(rules, 'Novedad')?.mode, 'AUTO')
  assert.equal(findRule(rules, 'Pre-novedad')?.mode, 'AUTO')
  assert.equal(findRule(rules, 'Mejora'), null)
})

test('guardar la regla de un tipo no apaga los de fábrica', async () => {
  await saveRule(actor, { tipo: 'Mejora', mode: 'MANUAL', requiredFields: ['titulo'] })
  const rules = await loadRules()
  assert.equal(findRule(rules, 'Mejora')?.mode, 'MANUAL')
  assert.equal(findRule(rules, 'Novedad')?.mode, 'AUTO')
})

test('pasar a AUTO fija el corte (sin retroactivos); salir de AUTO lo borra; seguir en AUTO lo conserva', async () => {
  await saveRule(actor, { tipo: 'Mejora', mode: 'AUTO', requiredFields: ['titulo'] })
  const first = findRule(await loadRules(), 'Mejora')!.autoSince
  assert.ok(first)
  await saveRule(actor, { tipo: 'Mejora', mode: 'AUTO', requiredFields: ['titulo', 'producto'] })
  assert.equal(findRule(await loadRules(), 'Mejora')!.autoSince, first)
  await saveRule(actor, { tipo: 'Mejora', mode: 'MANUAL', requiredFields: ['titulo'] })
  assert.equal(findRule(await loadRules(), 'Mejora')!.autoSince, null)
})

test('validaciones: tipo desconocido, modo, campos y cambios vacíos', async () => {
  await rejects(saveRule(actor, { tipo: 'Inventado', mode: 'AUTO', requiredFields: ['titulo'] }), /no existe/)
  await rejects(saveRule(actor, { tipo: 'Mejora', mode: 'SIEMPRE', requiredFields: ['titulo'] }), /Modo inválido/)
  await rejects(saveRule(actor, { tipo: 'Mejora', mode: 'AUTO', requiredFields: ['inventado'] }), /no válidos/)
  await rejects(saveRule(actor, { tipo: 'Mejora', mode: 'AUTO', requiredFields: [] }), /al menos un campo/)
  await rejects(saveRule(actor, { tipo: 'Novedad', mode: 'AUTO', requiredFields: DEFAULT_REQUIRED_FIELDS }), /No hay cambios/)
})

test('cada cambio queda en el audit log con quién, cuándo y de qué a qué', async () => {
  await saveRule(actor, { tipo: 'Mejora', mode: 'MANUAL', requiredFields: ['titulo'] })
  const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'COMMUNICATION_RULE_UPDATED' } })
  assert.equal(log.userEmail, actor.email)
  const d = log.details as { tipo: string; from: { mode: string }; to: { mode: string } }
  assert.deepEqual([d.tipo, d.from.mode, d.to.mode], ['Mejora', 'DISABLED', 'MANUAL'])
})

test('getRulesState: un tipo sin configurar sale deshabilitado y marcado como «unset»', async () => {
  const state = await getRulesState()
  assert.deepEqual(state.map((r) => [r.tipo, r.mode, r.source]), [['Novedad', 'AUTO', 'default'], ['Pre-novedad', 'AUTO', 'default'], ['Mejora', 'DISABLED', 'unset']])
})
