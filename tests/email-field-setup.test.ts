import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { ensureTraeVideoField, unifyPreNovedad } from '@/lib/email/field-setup'
import { resetDb } from './helpers'

async function resetFields() {
  await prisma.field.deleteMany()
}

async function setupTipo(options: string[]) {
  const tipo = await prisma.field.create({ data: { name: 'Tipo', type: 'select', order: 1, options: { create: options.map((name, i) => ({ name, order: i })) } } })
  return tipo
}

beforeEach(async () => {
  await resetDb()
  await resetFields()
})

// Estas pruebas arman sus propios campos: al terminar se limpian para que las demás suites los vuelvan a crear completos.
after(resetFields)

test('crea «¿Trae video?» como selector Sí/No justo después de «Video», sin mover el resto de forma desordenada', async () => {
  await prisma.field.createMany({ data: [{ name: 'Título', type: 'text', order: 0 }, { name: 'Video', type: 'url', order: 1 }, { name: 'SH', type: 'select', order: 2 }, { name: 'Otro', type: 'text', order: 3 }] })

  const dry = await ensureTraeVideoField({ apply: false })
  assert.deepEqual([dry.existed, dry.created], [false, false])
  assert.equal(await prisma.field.count({ where: { name: '¿Trae video?' } }), 0, 'el simulacro no escribe')

  const done = await ensureTraeVideoField({ apply: true })
  assert.deepEqual([done.existed, done.created], [false, true])
  const field = await prisma.field.findFirstOrThrow({ where: { name: '¿Trae video?' }, include: { options: { orderBy: { order: 'asc' } } } })
  assert.equal(field.type, 'select')
  assert.deepEqual(field.options.map((o) => o.name), ['Sí', 'No'])

  const order = (await prisma.field.findMany({ orderBy: { order: 'asc' } })).map((f) => f.name)
  assert.deepEqual(order, ['Título', 'Video', '¿Trae video?', 'SH', 'Otro'])
})

test('es idempotente y completa opciones faltantes sin duplicar el campo', async () => {
  await ensureTraeVideoField({ apply: true })
  const again = await ensureTraeVideoField({ apply: true })
  assert.deepEqual([again.existed, again.created, again.addedOptions], [true, false, []])
  assert.equal(await prisma.field.count({ where: { name: '¿Trae video?' } }), 1)

  const f = await prisma.field.findFirstOrThrow({ where: { name: '¿Trae video?' } })
  await prisma.tag.deleteMany({ where: { fieldId: f.id, name: 'No' } })
  const fix = await ensureTraeVideoField({ apply: true })
  assert.deepEqual(fix.addedOptions, ['No'])
  assert.equal(await prisma.tag.count({ where: { fieldId: f.id } }), 2)
})

test('unifica «Pre novedad» en «Pre-novedad»: migra registros, quita la opción duplicada, simulacro no escribe', async () => {
  const tipo = await setupTipo(['Novedad', 'Pre-novedad', 'Pre novedad', 'Experimento'])
  const mk = (t: string) => prisma.record.create({ data: { data: { [tipo.id]: t }, createdByEmail: 'a@alegra.com', createdByName: 'A' } })
  await mk('Pre novedad')
  await mk('Pre novedad')
  await mk('Pre-novedad')
  await mk('Novedad')

  const dry = await unifyPreNovedad({ apply: false })
  assert.deepEqual([dry.canonical, dry.recordsToUpdate, dry.updated], ['Pre-novedad', 2, 0])
  assert.deepEqual(dry.options, ['Novedad', 'Pre-novedad', 'Pre novedad', 'Experimento'])
  assert.equal(await prisma.record.count({ where: { data: { path: [tipo.id], equals: 'Pre novedad' } } }), 2)

  const done = await unifyPreNovedad({ apply: true })
  assert.deepEqual([done.updated, done.removedOptions], [2, 1])
  assert.equal(await prisma.record.count({ where: { data: { path: [tipo.id], equals: 'Pre-novedad' } } }), 3)
  assert.equal(await prisma.record.count({ where: { data: { path: [tipo.id], equals: 'Pre novedad' } } }), 0)
  assert.deepEqual((await prisma.tag.findMany({ where: { fieldId: tipo.id }, orderBy: { order: 'asc' } })).map((t) => t.name), ['Novedad', 'Pre-novedad', 'Experimento'])

  const again = await unifyPreNovedad({ apply: true })
  assert.deepEqual([again.recordsToUpdate, again.updated, again.removedOptions], [0, 0, 0])
})

test('sin duplicados o sin campo Tipo no toca nada y lo dice', async () => {
  assert.equal((await unifyPreNovedad({ apply: true })).tipoField, false)
  const tipo = await setupTipo(['Novedad', 'Pre novedad'])
  const r = await unifyPreNovedad({ apply: true })
  assert.deepEqual([r.variants, r.updated, r.removedOptions], [['Pre novedad'], 0, 0])
  assert.equal(await prisma.tag.count({ where: { fieldId: tipo.id } }), 2)
})

test('reconoce variantes con guion, mayúsculas y espacios y elige «Pre-novedad» como canónica', async () => {
  const tipo = await setupTipo(['PRE NOVEDAD', 'pre-novedad', 'Pre-novedad'])
  const r = await unifyPreNovedad({ apply: false })
  assert.equal(r.canonical, 'Pre-novedad')
  assert.equal(r.variants.length, 3)
  assert.ok(tipo.id)
})
