import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { resetDb } from './helpers'

beforeEach(resetDb)

const base = { mode: 'live', status: 'sending', channel: 'web', trigger: 'manual', triggeredByEmail: 'a@alegra.com' }

test('EmailDelivery.lockKey es único: solo un envío en curso/completado por novedad', async () => {
  await prisma.emailDelivery.create({ data: { ...base, recordId: 'r1', lockKey: 'novedad:r1' } })
  await assert.rejects(
    prisma.emailDelivery.create({ data: { ...base, recordId: 'r1', lockKey: 'novedad:r1' } }),
    (e: { code?: string }) => e.code === 'P2002'
  )
})

test('lockKey nulo no choca: fallidos, pruebas y simulacros se acumulan', async () => {
  for (let i = 0; i < 3; i++) {
    await prisma.emailDelivery.create({ data: { ...base, recordId: 'r1', status: 'failed', lockKey: null } })
  }
  assert.equal(await prisma.emailDelivery.count(), 3)
})

test('al liberar el lock (fallo) se puede reintentar', async () => {
  const d = await prisma.emailDelivery.create({ data: { ...base, recordId: 'r2', lockKey: 'novedad:r2' } })
  await prisma.emailDelivery.update({ where: { id: d.id }, data: { status: 'failed', lockKey: null } })
  await prisma.emailDelivery.create({ data: { ...base, recordId: 'r2', lockKey: 'novedad:r2' } })
  assert.equal(await prisma.emailDelivery.count({ where: { lockKey: 'novedad:r2' } }), 1)
})

test('EmailSettings es singleton con defaults seguros (modo webhook = sin cambios de comportamiento)', async () => {
  const s = await prisma.emailSettings.upsert({ where: { id: 'singleton' }, update: {}, create: {} })
  assert.equal(s.mode, 'webhook')
  assert.equal(s.fromName, 'Alegra Product News')
  assert.deepEqual(s.testRecipients, [])
})
