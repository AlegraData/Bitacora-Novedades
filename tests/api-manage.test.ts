import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { createKeyFor, updateKeyFor, revokeKeyFor, usageFor, listMine, listAll, type ManageActor } from '@/lib/api/manage'
import { hashToken } from '@/lib/api/keys'
import { resetDb, makeUser } from './helpers'

let ana: ManageActor
let bob: ManageActor
let adm: ManageActor

async function mkKey(actor: ManageActor) {
  const res = await createKeyFor(actor, { name: 'a', scopes: ['records:read'] })
  assert.ok(res.ok)
  return res.data.key
}

beforeEach(async () => {
  await resetDb()
  const mk = async (email: string, role: 'ADMIN' | 'VIEWER'): Promise<ManageActor> => {
    const u = await makeUser(email, role)
    return { id: u.id, email, name: u.name, role }
  }
  ana = await mk('ana@alegra.com', 'VIEWER')
  bob = await mk('bob@alegra.com', 'VIEWER')
  adm = await mk('adm@alegra.com', 'ADMIN')
})

test('crear: devuelve el token una vez, audita sin filtrar el secreto', async () => {
  const res = await createKeyFor(ana, { name: 'mi script', scopes: ['records:read'] })
  assert.ok(res.ok)
  const { token, key } = res.data

  const logs = await prisma.auditLog.findMany({ where: { action: 'API_KEY_CREATED' } })
  assert.equal(logs.length, 1)
  const dump = JSON.stringify(logs)
  assert.ok(!dump.includes(token), 'el token no debe aparecer en la auditoría')
  assert.ok(!dump.includes(hashToken(token)), 'ni su hash')
  assert.equal((logs[0].details as Record<string, unknown>).keyId, key.id)
  assert.equal(logs[0].userEmail, ana.email)
})

test('errores de negocio se devuelven como resultado (no excepciones) y no auditan', async () => {
  for (let i = 0; i < 3; i++) assert.ok((await createKeyFor(ana, { name: `k${i}`, scopes: ['records:read'] })).ok)
  const fourth = await createKeyFor(ana, { name: 'k4', scopes: ['records:read'] })
  assert.ok(!fourth.ok && fourth.code === 'LIMIT_REACHED')
  assert.equal(await prisma.auditLog.count({ where: { action: 'API_KEY_CREATED' } }), 3)

  const bad = await createKeyFor(bob, { name: '', scopes: [] })
  assert.ok(!bad.ok && bad.code === 'VALIDATION')
  const esc = await createKeyFor(bob, { name: 'x', scopes: ['records:delete'] })
  assert.ok(!esc.ok && esc.code === 'FORBIDDEN')
})

test('listMine solo trae lo propio; listAll solo para ADMIN', async () => {
  await createKeyFor(ana, { name: 'a', scopes: ['records:read'] })
  await createKeyFor(bob, { name: 'b', scopes: ['records:read'] })
  assert.deepEqual((await listMine(ana)).map((k) => k.name), ['a'])
  assert.equal((await listAll(adm)).length, 2)
  assert.throws(() => listAll(ana), /ADMIN/)
})

test('editar y revocar: dueño y ADMIN pueden; terceros no; ambos auditan', async () => {
  const key = await mkKey(ana)

  const denied = await updateKeyFor(bob, key.id, { name: 'hack' })
  assert.ok(!denied.ok && denied.code === 'NOT_FOUND')
  const deniedRevoke = await revokeKeyFor(bob, key.id)
  assert.ok(!deniedRevoke.ok)
  assert.equal((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt, null)

  const edited = await updateKeyFor(ana, key.id, { name: 'renombrado', scopes: ['records:read', 'audit:read'] })
  assert.ok(edited.ok && edited.data.name === 'renombrado')

  const byAdmin = await updateKeyFor(adm, key.id, { expiresInDays: 365 })
  assert.ok(byAdmin.ok)
  const byOwner = await updateKeyFor(ana, key.id, { expiresInDays: 365 })
  assert.ok(!byOwner.ok && byOwner.code === 'FORBIDDEN')

  assert.ok((await revokeKeyFor(adm, key.id)).ok)
  const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })
  assert.ok(row.revokedAt)
  assert.equal(row.revokedByEmail, adm.email)

  const actions = (await prisma.auditLog.findMany({ orderBy: { timestamp: 'asc' } })).map((l) => l.action)
  assert.deepEqual(actions, ['API_KEY_CREATED', 'API_KEY_UPDATED', 'API_KEY_UPDATED', 'API_KEY_REVOKED'])
})

test('uso de un token: visible para dueño y ADMIN, no para terceros', async () => {
  const key = await mkKey(ana)
  await prisma.apiRequestLog.create({ data: { apiKeyId: key.id, method: 'GET', path: '/api/v1/me', status: 200, durationMs: 1, ip: '1.2.3.4' } })
  const mine = await usageFor(ana, key.id)
  assert.ok(mine.ok && mine.data.last24h === 1 && mine.data.ips[0] === '1.2.3.4')
  assert.ok((await usageFor(adm, key.id)).ok)
  const other = await usageFor(bob, key.id)
  assert.ok(!other.ok && other.code === 'NOT_FOUND')
})
