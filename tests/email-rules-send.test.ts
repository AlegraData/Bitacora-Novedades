import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { sendNovedad } from '@/lib/email/service'
import { saveRule } from '@/lib/email/rules'
import { DEFAULT_REQUIRED_FIELDS, TIPO_NO_COMUNICABLE } from '@/lib/email/communication'
import { prisma } from '@/lib/prisma'
import { resetDb, ensureFields } from './helpers'
import { clearMailbox, listMessages } from './mailpit'
import { viewer, makeRecord, setMode } from './email-helpers'

const tomas = { id: 'u1', email: 'tomas.lopera@alegra.com', name: 'Tomas' }
const send = (id: string, trigger: 'auto' | 'manual' = 'auto') => sendNovedad({ recordId: id, actor: viewer, channel: 'web', trigger })

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  await clearMailbox()
  await setMode('live')
})

test('MANUAL: nunca sale solo; con la acción explícita sí sale (si los campos están completos)', async () => {
  await saveRule(tomas, { tipo: 'Mejora', mode: 'MANUAL', requiredFields: DEFAULT_REQUIRED_FIELDS })
  const r = await makeRecord({ tipo: 'Mejora' })
  const auto = await send(r.id)
  assert.deepEqual([auto.status, auto.skippedReason], ['skipped', 'tipo_solo_manual'])
  assert.equal((await listMessages()).length, 0)
  assert.equal(await prisma.emailDelivery.count({ where: { recordId: r.id } }), 0)
  assert.equal((await send(r.id, 'manual')).status, 'sent')
  assert.equal((await listMessages()).length, 1)
})

test('MANUAL valida los mismos campos obligatorios antes de enviar', async () => {
  await saveRule(tomas, { tipo: 'Mejora', mode: 'MANUAL', requiredFields: DEFAULT_REQUIRED_FIELDS })
  const r = await makeRecord({ tipo: 'Mejora', breveDescripcion: undefined })
  const res = await send(r.id, 'manual')
  assert.equal(res.error?.code, 'VALIDATION')
  assert.deepEqual(res.missingFields, ['Breve descripción'])
})

test('DISABLED: ni automático ni manual', async () => {
  await saveRule(tomas, { tipo: 'Novedad', mode: 'DISABLED', requiredFields: DEFAULT_REQUIRED_FIELDS })
  const r = await makeRecord({ tipo: 'Novedad' })
  assert.deepEqual([(await send(r.id)).status, (await send(r.id)).skippedReason], ['skipped', 'tipo_no_comunicable'])
  const manual = await send(r.id, 'manual')
  assert.deepEqual([manual.status, manual.error?.message], ['failed', TIPO_NO_COMUNICABLE])
  assert.equal((await listMessages()).length, 0)
})

test('AUTO en un tipo nuevo: sale solo, pero no las novedades creadas antes de activarlo', async () => {
  const antes = await makeRecord({ tipo: 'Mejora' }, new Date(Date.now() - 3_600_000))
  await saveRule(tomas, { tipo: 'Mejora', mode: 'AUTO', requiredFields: DEFAULT_REQUIRED_FIELDS })
  const despues = await makeRecord({ tipo: 'Mejora' }, new Date(Date.now() + 60_000))
  assert.equal((await send(antes.id)).skippedReason, 'registro_anterior_al_cutover')
  assert.equal((await send(despues.id)).status, 'sent')
  // lo anterior sigue pudiéndose enviar a mano
  assert.equal((await send(antes.id, 'manual')).status, 'sent')
})

test('el criterio es por tipo y por campo: solo se exige lo que la regla pide', async () => {
  await saveRule(tomas, { tipo: 'Mejora', mode: 'AUTO', requiredFields: ['titulo'] })
  const poco = await makeRecord({ tipo: 'Mejora', breveDescripcion: undefined, fechaProduccion: undefined, traeVideo: undefined }, new Date(Date.now() + 60_000))
  assert.equal((await send(poco.id)).status, 'sent')
  // mientras que Novedad conserva su criterio de siempre
  const nov = await makeRecord({ tipo: 'Novedad', breveDescripcion: undefined })
  assert.deepEqual((await send(nov.id)).missingFields, ['Breve descripción'])
})
