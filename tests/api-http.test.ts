import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createApiKey, revokeApiKey, generateToken } from '@/lib/api/keys'
import { apiRoute, apiJson, toolResultResponse } from '@/lib/api/http'
import { keyLimiter, failedAuthLimiter } from '@/lib/api/rate-limit'
import { resetDb, makeUser } from './helpers'

const owner = { email: 'owner@alegra.com', role: 'ADMIN' as const }

// Endpoint de prueba: devuelve quién es el caller y las cabeceras que recibió.
const rawRoute = apiRoute('records:read', async ({ caller, scopes, params }) =>
  apiJson({ email: caller.email, role: caller.role, via: caller.via, scopes, params })
)
const rawThrowing = apiRoute(null, async () => {
  throw new Error('secreto interno: password=123')
})

type Ctx = { params: Promise<Record<string, string>> }
const noCtx: Ctx = { params: Promise.resolve({}) }
const route = (r: NextRequest, c: Ctx = noCtx) => rawRoute(r, c)
const throwing = (r: NextRequest, c: Ctx = noCtx) => rawThrowing(r, c)

function req(path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new NextRequest(`http://localhost${path}`, { method, headers })
}
const auth = (t: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${t}`, ...extra })

async function newKey(scopes: string[] = ['records:read']) {
  return createApiKey(owner, { name: 'k', scopes })
}

beforeEach(async () => {
  await resetDb()
  await makeUser(owner.email, 'ADMIN')
  keyLimiter.reset()
  keyLimiter.setLimit(120)
  failedAuthLimiter.reset()
})

test('sin token → 401 con WWW-Authenticate y sin pistas', async () => {
  const res = await route(req('/api/v1/x'))
  assert.equal(res.status, 401)
  assert.match(res.headers.get('www-authenticate')!, /^Bearer/)
  assert.equal((await res.json()).error.code, 'missing_token')
})

test('token válido → 200, identidad del dueño, headers de seguridad y rate limit', async () => {
  const { token, key } = await newKey()
  const res = await route(req('/api/v1/x', auth(token)), { params: Promise.resolve({ id: 'abc' }) })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.headers.get('x-ratelimit-limit'), '120')
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'la API no habilita CORS')
  const body = await res.json()
  assert.equal(body.email, owner.email)
  assert.deepEqual(body.via, { channel: 'api', apiKeyId: key.id, apiKeyName: 'k' })
  assert.deepEqual(body.params, { id: 'abc' })
})

test('esquema Bearer es case-insensitive; token por query string o Basic se ignora', async () => {
  const { token } = await newKey()
  assert.equal((await route(req('/x', { authorization: `bearer ${token}` }))).status, 200)
  assert.equal((await route(req(`/x?token=${token}&access_token=${token}&api_key=${token}`))).status, 401)
  assert.equal((await route(req('/x', { authorization: `Basic ${token}` }))).status, 401)
  assert.equal((await route(req('/x', { 'x-api-key': token }))).status, 401)
  assert.equal((await route(req('/x', { authorization: `Bearer ${token} extra` }))).status, 401)
})

test('tokens inválidos, revocados y expirados → 401; el cuerpo nunca devuelve el token', async () => {
  const garbage = await route(req('/x', auth('btk_basura')))
  assert.equal((await garbage.json()).error.code, 'invalid_token')

  const unknown = generateToken()
  const res = await route(req('/x', auth(unknown)))
  assert.equal(res.status, 401)
  assert.ok(!(await res.text()).includes(unknown))

  const revoked = await newKey()
  await revokeApiKey(revoked.key.id, owner)
  const r2 = await route(req('/x', auth(revoked.token)))
  assert.equal(r2.status, 401)
  assert.equal((await r2.json()).error.code, 'invalid_token', 'revocado no se distingue de inexistente')

  const expired = await newKey()
  await prisma.apiKey.update({ where: { id: expired.key.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
  const r3 = await route(req('/x', auth(expired.token)))
  assert.equal(r3.status, 401)
  assert.equal((await r3.json()).error.code, 'token_expired')
})

test('scope insuficiente → 403 y queda registrado', async () => {
  const { token, key } = await newKey(['audit:read'])
  const res = await route(req('/api/v1/records', auth(token)))
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error.code, 'insufficient_scope')
  const log = await prisma.apiRequestLog.findFirstOrThrow({ where: { apiKeyId: key.id } })
  assert.equal(log.status, 403)
})

test('cada request exitoso registra uso: log, lastUsed*, useCount, IP (último hop de XFF) y UA', async () => {
  const { token, key } = await newKey()
  await route(req('/api/v1/records?x=1', auth(token, { 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'user-agent': 'GoogleApps/1.0' })))
  await route(req('/api/v1/records', auth(token)))

  const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })
  assert.equal(row.useCount, 2)
  assert.ok(row.lastUsedAt)
  const logs = await prisma.apiRequestLog.findMany({ where: { apiKeyId: key.id }, orderBy: { timestamp: 'asc' } })
  assert.equal(logs.length, 2)
  assert.equal(logs[0].ip, '203.0.113.9', 'no se confía en la IP que el cliente pone al inicio de X-Forwarded-For')
  assert.equal(logs[0].userAgent, 'GoogleApps/1.0')
  assert.equal(logs[0].path, '/api/v1/records', 'el query string no se guarda (puede traer datos sensibles)')
})

test('X-Forwarded-For malicioso no se persiste', async () => {
  const { token, key } = await newKey()
  await route(req('/x', auth(token, { 'x-forwarded-for': "1.1.1.1'; DROP TABLE \"ApiKey\";--" })))
  const log = await prisma.apiRequestLog.findFirstOrThrow({ where: { apiKeyId: key.id } })
  assert.equal(log.ip, null)
  assert.equal(await prisma.apiKey.count(), 1)
})

test('rate limit por token → 429 con Retry-After, sin afectar a otro token', async () => {
  keyLimiter.setLimit(3)
  const a = await newKey()
  const b = await newKey()
  const statuses: number[] = []
  for (let i = 0; i < 5; i++) statuses.push((await route(req('/x', auth(a.token)))).status)
  assert.deepEqual(statuses, [200, 200, 200, 429, 429])
  const limited = await route(req('/x', auth(a.token)))
  assert.ok(Number(limited.headers.get('retry-after')) >= 1)
  assert.equal((await route(req('/x', auth(b.token)))).status, 200)
})

test('fuerza bruta: tras 20 intentos fallidos desde una IP se bloquea hasta con token válido', async () => {
  const { token } = await newKey()
  const ip = { 'x-forwarded-for': '198.51.100.7' }
  for (let i = 0; i < 20; i++) assert.equal((await route(req('/x', auth(generateToken(), ip)))).status, 401)
  const blocked = await route(req('/x', auth(token, ip)))
  assert.equal(blocked.status, 429)
  assert.equal((await blocked.json()).error.code, 'too_many_attempts')
  // otra IP no se ve afectada
  assert.equal((await route(req('/x', auth(token, { 'x-forwarded-for': '198.51.100.8' })))).status, 200)
})

test('el rol del dueño se evalúa en cada request (degradar al dueño surte efecto inmediato)', async () => {
  const { token } = await newKey()
  assert.equal((await (await route(req('/x', auth(token)))).json()).role, 'ADMIN')
  await prisma.user.update({ where: { email: owner.email }, data: { role: 'VIEWER' } })
  assert.equal((await (await route(req('/x', auth(token)))).json()).role, 'VIEWER')
})

test('error no controlado → 500 genérico sin filtrar detalles, y queda registrado', async () => {
  const { token, key } = await newKey()
  const res = await throwing(req('/x', auth(token)))
  assert.equal(res.status, 500)
  const text = await res.text()
  assert.ok(!text.includes('secreto') && !text.includes('password'))
  assert.equal((await prisma.apiRequestLog.findFirstOrThrow({ where: { apiKeyId: key.id } })).status, 500)
})

test('toolResultResponse mapea errores de los handlers a códigos HTTP', async () => {
  assert.equal(toolResultResponse({ ok: 1 }, 201).status, 201)
  assert.equal(toolResultResponse({ error: 'Registro "x" no encontrado.' }).status, 404)
  assert.equal(toolResultResponse({ error: 'No puedes editar este registro — fue creado por a@b.c.' }).status, 403)
  assert.equal(toolResultResponse({ error: 'Esta acción requiere rol ADMIN.' }).status, 403)
  const v = toolResultResponse({ error: 'Validación fallida', details: ['x'] })
  assert.equal(v.status, 400)
  assert.deepEqual((await v.json()).error.details, ['x'])
})
