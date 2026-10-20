/**
 * Smoke e2e por HTTP real. Requiere un servidor corriendo contra la BD de pruebas:
 *   NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy \
 *   DATABASE_URL=<local> npm run build && DATABASE_URL=<local> npx next start -p 3999
 *   E2E_BASE_URL=http://localhost:3999 npm run test:e2e
 */
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { createApiKey } from '@/lib/api/keys'
import { resetDb, makeUser, ensureFields } from '../helpers'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3999'
let failures = 0

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`  ✔ ${name}`)
  } catch (e) {
    failures++
    console.log(`  ✖ ${name}\n    ${(e as Error).message.split('\n')[0]}`)
  }
}

const api = (path: string, init: RequestInit = {}, token?: string) =>
  fetch(`${BASE}/api/v1${path}`, {
    redirect: 'manual',
    ...init,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string>) },
  })

async function main() {
  await resetDb()
  await ensureFields()
  await makeUser('admin@alegra.com', 'ADMIN')
  await makeUser('viewer@alegra.com', 'VIEWER')
  const rw = (await createApiKey({ email: 'viewer@alegra.com', role: 'VIEWER' }, { name: 'rw', scopes: ['records:read', 'records:write'] })).token
  const ro = (await createApiKey({ email: 'admin@alegra.com', role: 'ADMIN' }, { name: 'ro-admin', scopes: ['records:read'] })).token
  const del = (await createApiKey({ email: 'admin@alegra.com', role: 'ADMIN' }, { name: 'del', scopes: ['records:read', 'records:delete'] })).token

  console.log(`E2E contra ${BASE}`)
  let recordId = ''

  await check('sin token → 401 JSON (no redirige a login de Supabase)', async () => {
    const r = await api('/records')
    assert.equal(r.status, 401)
    assert.match(r.headers.get('content-type')!, /json/)
    assert.match(r.headers.get('www-authenticate')!, /Bearer/)
  })
  await check('GET /me con token → 200 y headers de seguridad', async () => {
    const r = await api('/me', {}, rw)
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(r.headers.get('access-control-allow-origin'), null)
    assert.equal((await r.json()).user.email, 'viewer@alegra.com')
  })
  await check('token en query string NO autentica', async () => {
    assert.equal((await api(`/me?token=${rw}`)).status, 401)
  })
  await check('POST crea y GET lee el mismo registro', async () => {
    const c = await api('/records', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'Novedad', titulo: 'E2E', fechaLanzamiento: '2026-11-01', elaborado: 'viewer@alegra.com', proyectoLinear: 'E2E-1' }),
    }, rw)
    assert.equal(c.status, 201)
    recordId = (await c.json()).id
    const g = await api(`/records/${recordId}?fields=titulo,proyectoLinear`, {}, rw)
    assert.deepEqual(await g.json(), { id: recordId, titulo: 'E2E', proyectoLinear: 'E2E-1' })
    const l = await (await api('/records?proyectoLinear=e2e-1', {}, rw)).json()
    assert.equal(l.total, 1)
  })
  await check('token de solo lectura (aunque su dueño sea ADMIN) no escribe ni borra', async () => {
    const w = await api('/records', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, ro)
    assert.equal(w.status, 403)
    assert.equal((await api(`/records/${recordId}`, { method: 'DELETE' }, ro)).status, 403)
    assert.equal(await prisma.record.count(), 1)
  })
  await check('otro usuario no puede editar el registro ajeno', async () => {
    const r = await api(`/records/${recordId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"titulo":"x"}' }, rw)
    assert.equal(r.status, 200, 'el autor sí puede')
    const viewer2 = await makeUser('otro@alegra.com', 'VIEWER')
    const t = (await createApiKey({ email: viewer2.email, role: 'VIEWER' }, { name: 'o', scopes: ['records:write'] })).token
    const d = await api(`/records/${recordId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"titulo":"hack"}' }, t)
    assert.equal(d.status, 403)
  })
  await check('métodos no soportados → 405; HEAD/OPTIONS no filtran datos', async () => {
    assert.equal((await api('/records', { method: 'PUT' }, rw)).status, 405)
    assert.equal((await api('/me', { method: 'DELETE' }, rw)).status, 405)
    const o = await api('/records', { method: 'OPTIONS' })
    assert.ok([204, 200, 405].includes(o.status))
    assert.equal(o.headers.get('access-control-allow-origin'), null)
  })
  await check('ids hostiles → 404 sin error 500', async () => {
    for (const id of ["' OR 1=1--", '..%2F..%2Fetc%2Fpasswd', '%00']) {
      const r = await api(`/records/${id}`, {}, rw)
      assert.ok([404, 400].includes(r.status), `${id} → ${r.status}`)
    }
  })
  await check('DELETE exige scope + ADMIN y funciona', async () => {
    const r = await api(`/records/${recordId}`, { method: 'DELETE' }, del)
    assert.equal(r.status, 200)
    assert.equal(await prisma.record.count(), 0)
  })
  await check('openapi.json es público y válido', async () => {
    const r = await api('/openapi.json')
    assert.equal(r.status, 200)
    assert.equal((await r.json()).openapi, '3.0.3')
  })
  await check('/api-tokens sin sesión redirige a login (la UI sigue protegida)', async () => {
    const r = await fetch(`${BASE}/api-tokens`, { redirect: 'manual' })
    assert.ok([302, 307, 308].includes(r.status), `status ${r.status}`)
    assert.match(r.headers.get('location') ?? '', /login/)
  })
  await check('uso registrado por token (log + contadores)', async () => {
    const key = await prisma.apiKey.findFirstOrThrow({ where: { name: 'rw' } })
    assert.ok(key.useCount >= 4)
    assert.ok(key.lastUsedAt)
    assert.ok((await prisma.apiRequestLog.count({ where: { apiKeyId: key.id } })) >= 4)
  })
  await check('fuerza bruta: 20 tokens inválidos → 429', async () => {
    const hdr = { 'x-forwarded-for': '203.0.113.50' }
    let last = 0
    for (let i = 0; i < 25; i++) last = (await api('/me', { headers: hdr }, `btk_${'A'.repeat(43)}`)).status
    assert.equal(last, 429)
  })

  console.log(failures === 0 ? '\nE2E OK' : `\n${failures} fallo(s)`)
  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
