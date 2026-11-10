import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { getApiOverview, getApiActivity, classifyStatus } from '@/lib/admin/api-dashboard'
import { createApiKey, revokeApiKey } from '@/lib/api/keys'
import { resetDb, makeUser } from './helpers'

const NOW = Date.now()
const H = 3_600_000

beforeEach(async () => {
  await resetDb()
  await makeUser('ana@alegra.com', 'ADMIN')
  await makeUser('beto@alegra.com', 'VIEWER')
})

async function req(apiKeyId: string, status: number, hoursAgo: number, path = '/api/v1/records') {
  await prisma.apiRequestLog.create({ data: { apiKeyId, method: 'GET', path, status, ip: '1.1.1.1', userAgent: 'curl', durationMs: 20, timestamp: new Date(NOW - hoursAgo * H) } })
}

test('classifyStatus: 2xx/3xx correcta; 401/403/429 denegada; otros 4xx y 5xx error', () => {
  for (const s of [200, 201, 204, 304]) assert.equal(classifyStatus(s), 'ok', String(s))
  for (const s of [401, 403, 429]) assert.equal(classifyStatus(s), 'denied', String(s))
  for (const s of [400, 404, 422, 500, 503]) assert.equal(classifyStatus(s), 'error', String(s))
})

test('resumen: tokens vigentes, personas, permisos, resultados y llamadas por día', async () => {
  const ana = { email: 'ana@alegra.com', role: 'ADMIN' as const }
  const beto = { email: 'beto@alegra.com', role: 'VIEWER' as const }
  const k1 = await createApiKey(ana, { name: 'Reverse sync', scopes: ['records:read', 'records:write'] })
  const k2 = await createApiKey(beto, { name: 'Lectura', scopes: ['records:read'] })
  const k3 = await createApiKey(beto, { name: 'Vieja', scopes: ['records:read'] })
  await revokeApiKey(k3.key.id, beto)
  await req(k1.key.id, 200, 1)
  await req(k1.key.id, 200, 2)
  await req(k1.key.id, 403, 3)
  await req(k2.key.id, 500, 4)
  await req(k2.key.id, 200, 24 * 20) // fuera de 7 días

  const o = await getApiOverview(7, NOW)
  assert.deepEqual([o.people, o.activeTokens, o.requests], [2, 2, 4])
  assert.deepEqual(o.results, { ok: 2, denied: 1, error: 1 })
  assert.deepEqual(o.byScope, [{ scope: 'records:read', count: 2 }, { scope: 'records:write', count: 1 }])
  assert.equal(o.perDay.length, 7)
  assert.equal(o.perDay.reduce((n, d) => n + d.value, 0), 4)

  const a = o.rows.find((r) => r.email === 'ana@alegra.com')!
  assert.deepEqual([a.activeTokens, a.requests, a.tokens.length, a.tokens[0].requests], [1, 3, 1, 3])
  const b = o.rows.find((r) => r.email === 'beto@alegra.com')!
  assert.deepEqual(b.tokens.map((t) => t.status).sort(), ['active', 'revoked'])
  assert.ok(!JSON.stringify(o).includes('keyHash'), 'nunca expone el hash del token')
  assert.equal((await getApiOverview(30, NOW)).requests, 5)
})

test('actividad: paginada, con filtro por resultado y búsqueda por persona o nombre del token', async () => {
  const ana = { email: 'ana@alegra.com', role: 'ADMIN' as const }
  const beto = { email: 'beto@alegra.com', role: 'VIEWER' as const }
  const k1 = await createApiKey(ana, { name: 'Reverse sync', scopes: ['records:read'] })
  const k2 = await createApiKey(beto, { name: 'Lectura', scopes: ['records:read'] })
  for (let i = 0; i < 23; i++) await req(i % 2 ? k1.key.id : k2.key.id, i % 7 === 0 ? 403 : i % 11 === 0 ? 500 : 200, i + 1, i === 1 ? '/api/v1/records/abc' : '/api/v1/records')

  const p1 = await getApiActivity({}, NOW)
  assert.deepEqual([p1.rows.length, p1.total, p1.pageCount, p1.pageSize], [10, 23, 3, 10])
  assert.equal(p1.rows[0].tokenName, 'Lectura')
  assert.ok(p1.rows[0].tokenPrefix.startsWith('btk_'))
  assert.equal((await getApiActivity({ page: 3 }, NOW)).rows.length, 3)
  assert.equal((await getApiActivity({ pageSize: 50 }, NOW)).rows.length, 23)
  assert.equal((await getApiActivity({ result: 'denied' }, NOW)).total, 4)
  assert.equal((await getApiActivity({ result: 'error' }, NOW)).total, 2)
  assert.equal((await getApiActivity({ result: 'ok' }, NOW)).total, 17)
  assert.equal((await getApiActivity({ q: 'ana@' }, NOW)).total, 11)
  assert.equal((await getApiActivity({ q: 'reverse' }, NOW)).total, 11, 'por nombre del token')
  assert.equal((await getApiActivity({ q: 'zzz' }, NOW)).total, 0)
  assert.equal((await getApiActivity({ result: 'inventado' }, NOW)).total, 23)
})
