import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import {
  createApiKey, listApiKeys, updateApiKey, revokeApiKey, verifyApiKey, getApiKeyUsage,
  generateToken, hashToken, ApiKeyError, MAX_KEYS_PER_USER,
} from '@/lib/api/keys'
import { resetDb, makeUser } from './helpers'

const alice = { email: 'alice@alegra.com', role: 'VIEWER' as const }
const bob = { email: 'bob@alegra.com', role: 'VIEWER' as const }
const admin = { email: 'admin@alegra.com', role: 'ADMIN' as const }
const mk = (owner = alice, n = 'token') => createApiKey(owner, { name: n, scopes: ['records:read'] })

beforeEach(async () => {
  await resetDb()
  await makeUser(alice.email, 'VIEWER')
  await makeUser(bob.email, 'VIEWER')
  await makeUser(admin.email, 'ADMIN')
})

const code = (c: string) => (e: unknown) => e instanceof ApiKeyError && e.code === c

test('generateToken: formato btk_ + 43 chars y sin repetidos', () => {
  const set = new Set(Array.from({ length: 500 }, generateToken))
  assert.equal(set.size, 500)
  for (const t of set) assert.match(t, /^btk_[A-Za-z0-9_-]{43}$/)
})

test('createApiKey: devuelve el token una vez y en BD solo queda el hash', async () => {
  const { token, key } = await mk()
  assert.ok(token.startsWith('btk_'))
  assert.equal('token' in key, false)

  const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })
  assert.equal(row.keyHash, hashToken(token))
  assert.ok(!JSON.stringify(row).includes(token), 'el token en claro no debe persistirse en ninguna columna')
  assert.ok(token.startsWith(row.prefix))
  assert.ok(row.prefix.length < token.length / 2)
})

test('límite: máximo 3 tokens activos por usuario', async () => {
  for (let i = 0; i < MAX_KEYS_PER_USER; i++) await mk(alice, `t${i}`)
  await assert.rejects(mk(alice, 'cuarto'), code('LIMIT_REACHED'))
  await mk(bob, 'de-bob') // el límite es por usuario
})

test('límite: concurrencia — 10 creaciones simultáneas generan exactamente 3', async () => {
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => mk(alice, `c${i}`)))
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, MAX_KEYS_PER_USER)
  assert.equal(await prisma.apiKey.count({ where: { ownerEmail: alice.email } }), MAX_KEYS_PER_USER)
})

test('límite: revocar o expirar libera un cupo', async () => {
  const a = await mk(alice, 'a')
  const b = await mk(alice, 'b')
  await mk(alice, 'c')
  await assert.rejects(mk(alice, 'd'), code('LIMIT_REACHED'))

  await revokeApiKey(a.key.id, alice)
  await mk(alice, 'd')
  await assert.rejects(mk(alice, 'e'), code('LIMIT_REACHED'))

  await prisma.apiKey.update({ where: { id: b.key.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
  await mk(alice, 'e')
})

test('validación de entradas', async () => {
  await assert.rejects(createApiKey(alice, { name: '', scopes: ['records:read'] }), code('VALIDATION'))
  await assert.rejects(createApiKey(alice, { name: 'x'.repeat(61), scopes: ['records:read'] }), code('VALIDATION'))
  await assert.rejects(createApiKey(alice, { name: 'x', scopes: [] }), code('VALIDATION'))
  await assert.rejects(createApiKey(alice, { name: 'x', scopes: ['records:*'] }), code('VALIDATION'))
  await assert.rejects(createApiKey(alice, { name: 'x', scopes: 'records:read' }), code('VALIDATION'))
  await assert.rejects(createApiKey(alice, { name: 'x', scopes: ['records:read'], expiresInDays: 9999 }), code('VALIDATION'))
  await assert.rejects(createApiKey(alice, { name: 'x', scopes: ['records:read'], expiresInDays: -1 }), code('VALIDATION'))
  await assert.rejects(createApiKey(alice, { name: { $ne: 1 }, scopes: ['records:read'] }), code('VALIDATION'))
  await assert.rejects(createApiKey(alice, { name: 'x', description: 'd'.repeat(201), scopes: ['records:read'] }), code('VALIDATION'))
})

test('escalada de privilegios: records:delete solo para dueños ADMIN', async () => {
  await assert.rejects(createApiKey(alice, { name: 'x', scopes: ['records:delete'] }), code('FORBIDDEN'))
  const ok = await createApiKey(admin, { name: 'x', scopes: ['records:delete'] })
  assert.deepEqual(ok.key.scopes, ['records:delete'])

  // tampoco vía edición
  const { key } = await mk(alice)
  await assert.rejects(updateApiKey(key.id, alice, { scopes: ['records:delete'] }), code('FORBIDDEN'))
})

test('aislamiento: un usuario no ve, edita, revoca ni consulta uso de tokens ajenos', async () => {
  const { key } = await mk(alice)
  assert.equal((await listApiKeys({ ownerEmail: bob.email })).length, 0)
  await assert.rejects(updateApiKey(key.id, bob, { name: 'hack' }), code('NOT_FOUND'))
  await assert.rejects(revokeApiKey(key.id, bob), code('NOT_FOUND'))
  await assert.rejects(getApiKeyUsage(key.id, bob), code('NOT_FOUND'))
  await assert.rejects(revokeApiKey('id-inexistente', bob), code('NOT_FOUND'))
  assert.equal((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt, null)
})

test('un usuario que se hace pasar por ADMIN con el rol del cliente no obtiene nada: el rol viene del servidor', async () => {
  // Defensa en profundidad: el servicio confía en el Actor que arma el servidor (requireUser),
  // por eso las server actions nunca aceptan el rol desde el cliente (se verifica en el commit de UI).
  const { key } = await mk(alice)
  await updateApiKey(key.id, admin, { name: 'renombrado por admin', expiresInDays: 365 })
  const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })
  assert.equal(row.name, 'renombrado por admin')
  await assert.rejects(updateApiKey(key.id, alice, { expiresInDays: 365 }), code('FORBIDDEN'))
})

test('updateApiKey: edita nombre/descripción/scopes, rechaza vacío y revocados', async () => {
  const { key } = await mk(alice)
  const u = await updateApiKey(key.id, alice, { name: 'nuevo', description: 'desc', scopes: ['records:read', 'audit:read'] })
  assert.equal(u.name, 'nuevo')
  assert.deepEqual(u.scopes.sort(), ['audit:read', 'records:read'])
  await assert.rejects(updateApiKey(key.id, alice, {}), code('VALIDATION'))
  await revokeApiKey(key.id, alice)
  await assert.rejects(updateApiKey(key.id, alice, { name: 'x' }), code('VALIDATION'))
})

test('verifyApiKey: válido, desconocido, malformado, revocado, expirado', async () => {
  const { token, key } = await mk()
  const ok = await verifyApiKey(token)
  assert.ok(ok.ok && ok.key.id === key.id)

  assert.deepEqual(await verifyApiKey(generateToken()), { ok: false, reason: 'unknown' })
  for (const bad of ['', 'btk_', 'Bearer x', token + 'x', token.slice(0, -1), "btk_' OR 1=1 --", 'a'.repeat(10_000)]) {
    assert.deepEqual(await verifyApiKey(bad), { ok: false, reason: 'malformed' }, bad.slice(0, 20))
  }
  // el hash no sirve como credencial
  assert.equal((await verifyApiKey(hashToken(token))).ok, false)

  await prisma.apiKey.update({ where: { id: key.id }, data: { expiresAt: new Date(Date.now() - 1) } })
  assert.deepEqual(await verifyApiKey(token), { ok: false, reason: 'expired' })

  const second = await mk(alice, 'otro')
  await revokeApiKey(second.key.id, alice)
  assert.deepEqual(await verifyApiKey(second.token), { ok: false, reason: 'revoked' })
})

test('listApiKeys nunca expone hash ni token', async () => {
  const { token } = await mk()
  const serialized = JSON.stringify(await listApiKeys())
  assert.ok(!serialized.includes(token))
  assert.ok(!serialized.includes(hashToken(token)))
  assert.ok(!serialized.includes('keyHash'))
})

test('getApiKeyUsage agrega requests por estado, IP y ventana', async () => {
  const { key } = await mk()
  const base = { apiKeyId: key.id, method: 'GET', path: '/api/v1/records', durationMs: 5 }
  await prisma.apiRequestLog.createMany({
    data: [
      { ...base, status: 200, ip: '1.1.1.1' },
      { ...base, status: 200, ip: '2.2.2.2' },
      { ...base, status: 403, ip: '1.1.1.1' },
      { ...base, status: 200, ip: '9.9.9.9', timestamp: new Date(Date.now() - 3 * 86_400_000) },
      { ...base, status: 200, ip: '8.8.8.8', timestamp: new Date(Date.now() - 30 * 86_400_000) },
    ],
  })
  const u = await getApiKeyUsage(key.id, alice)
  assert.equal(u.last24h, 3)
  assert.equal(u.last7d, 4)
  assert.deepEqual(u.byStatus, { '200': 3, '403': 1 })
  assert.deepEqual(u.ips.sort(), ['1.1.1.1', '2.2.2.2', '9.9.9.9'])
  assert.equal(u.recent.length, 5)
})
