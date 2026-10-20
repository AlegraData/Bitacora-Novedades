import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { resetDb } from './helpers'

beforeEach(resetDb)

test('ApiKey: keyHash es único y los logs se borran en cascada', async () => {
  const base = {
    name: 'k', prefix: 'btk_abcd', scopes: ['records:read'], ownerEmail: 'a@alegra.com',
    expiresAt: new Date(Date.now() + 86_400_000),
  }
  const key = await prisma.apiKey.create({ data: { ...base, keyHash: 'h1' } })
  await assert.rejects(prisma.apiKey.create({ data: { ...base, keyHash: 'h1' } }))

  await prisma.apiRequestLog.create({ data: { apiKeyId: key.id, method: 'GET', path: '/api/v1/me', status: 200, durationMs: 3 } })
  await prisma.apiKey.delete({ where: { id: key.id } })
  assert.equal(await prisma.apiRequestLog.count(), 0)
})
