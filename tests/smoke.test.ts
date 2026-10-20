import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'

test('los tests apuntan a la base local, no a producción', () => {
  assert.match(process.env.DATABASE_URL!, /localhost|127\.0\.0\.1/)
})

test('la base de pruebas responde', async () => {
  const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`
  assert.equal(rows[0].ok, 1)
})
