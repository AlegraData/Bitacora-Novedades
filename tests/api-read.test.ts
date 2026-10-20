import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createApiKey } from '@/lib/api/keys'
import { keyLimiter, failedAuthLimiter } from '@/lib/api/rate-limit'
import { handleCreateRecord } from '@/lib/mcp/tools'
import { GET as me } from '@/app/api/v1/me/route'
import { GET as fieldsRoute } from '@/app/api/v1/fields/route'
import { GET as list } from '@/app/api/v1/records/route'
import { GET as search } from '@/app/api/v1/records/search/route'
import { GET as getOne } from '@/app/api/v1/records/[id]/route'
import { GET as auditLog } from '@/app/api/v1/audit-log/route'
import { resetDb, makeUser, ensureFields } from './helpers'

const owner = { email: 'svc@alegra.com', role: 'VIEWER' as const }
let token: string
let keyId: string
let ids: Record<string, string>

const call = (fn: (r: NextRequest, c?: never) => Promise<Response>, path: string, t = token) =>
  fn(new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${t}` } }))
const callOne = (id: string, qs = '', t = token) =>
  getOne(new NextRequest(`http://localhost/api/v1/records/${id}${qs}`, { headers: { authorization: `Bearer ${t}` } }), {
    params: Promise.resolve({ id }),
  })

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  keyLimiter.reset()
  failedAuthLimiter.reset()
  const u = await makeUser(owner.email, 'VIEWER')
  const caller = { id: u.id, email: u.email, name: u.name, role: 'VIEWER' as const }

  const base = { tipo: 'Novedad', fechaLanzamiento: '2026-01-01', elaborado: owner.email }
  const a = (await handleCreateRecord({ ...base, titulo: 'Facturación masiva', proyectoLinear: 'REVPYME-711', fechaProduccion: '2026-02-01', producto: ['Alegra POS'] }, caller)) as { id: string }
  const b = (await handleCreateRecord({ ...base, titulo: 'Nómina electrónica', tipo: 'Mejora', producto: ['Alegra Nómina'] }, caller)) as { id: string }
  ids = { a: a.id, b: b.id }

  const created = await createApiKey(owner, { name: 'svc', scopes: ['records:read'] })
  token = created.token
  keyId = created.key.id
  await prisma.auditLog.deleteMany() // deja solo la auditoría de las lecturas del test
})

test('GET /me: identidad y scopes del token, sin exponer secretos', async () => {
  const res = await call(me, '/api/v1/me')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.user.email, owner.email)
  assert.deepEqual(body.token.scopes, ['records:read'])
  assert.ok(!JSON.stringify(body).includes(token))
  assert.ok(!JSON.stringify(body).includes('keyHash'))
})

test('GET /fields: esquema de campos con tipos y opciones', async () => {
  const body = await (await call(fieldsRoute, '/api/v1/fields')).json()
  const tipo = body.fields.find((f: { key: string }) => f.key === 'tipo')
  assert.equal(tipo.type, 'select')
  assert.deepEqual(tipo.options, ['Novedad', 'Pre-novedad', 'Mejora'])
})

test('GET /records: lista, filtra y pagina', async () => {
  const all = await (await call(list, '/api/v1/records')).json()
  assert.equal(all.total, 2)

  const byProject = await (await call(list, '/api/v1/records?proyectoLinear=revpyme-711')).json()
  assert.deepEqual(byProject.records.map((r: { titulo: string }) => r.titulo), ['Facturación masiva'])

  const byTipo = await (await call(list, '/api/v1/records?tipo=Mejora')).json()
  assert.equal(byTipo.total, 1)

  const byProducto = await (await call(list, '/api/v1/records?producto=Alegra%20POS,Alegra%20Nómina')).json()
  assert.equal(byProducto.total, 2)

  const withProd = await (await call(list, '/api/v1/records?fechaProduccionDesde=2026-01-01')).json()
  assert.equal(withProd.total, 1)

  const page = await (await call(list, '/api/v1/records?limit=1&offset=1')).json()
  assert.equal(page.records.length, 1)
  assert.equal(page.total, 2)

  const capped = await (await call(list, '/api/v1/records?limit=99999')).json()
  assert.equal(capped.limit, 200)
})

test('GET /records?fields= proyecta solo lo pedido (+ id)', async () => {
  const body = await (await call(list, '/api/v1/records?fields=titulo,fechaProduccion')).json()
  for (const r of body.records) {
    assert.deepEqual(Object.keys(r).sort().filter((k) => k !== 'fechaProduccion'), ['id', 'titulo'])
    assert.ok(!('createdByEmail' in r))
  }
})

test('GET /records: parámetros inválidos → 400 (no se ignoran en silencio)', async () => {
  for (const qs of ['limit=abc', 'limit=-1', 'offset=1.5', 'limit=', 'foo=bar', 'fechaProduccionDesde=ayer', 'fechaLanzamientoHasta=2026-13-45', 'fields=password,titulo']) {
    const res = await call(list, `/api/v1/records?${qs}`)
    assert.equal(res.status, 400, qs)
    assert.equal((await res.json()).error.code, 'invalid_request')
  }
})

test('GET /records: texto con comillas/SQL se trata como dato, no rompe ni inyecta', async () => {
  for (const q of ["x'; DROP TABLE \"Record\";--", '%00', '<script>alert(1)</script>', '\\"', '${7*7}']) {
    const res = await call(list, `/api/v1/records?query=${encodeURIComponent(q)}&proyectoLinear=${encodeURIComponent(q)}`)
    assert.equal(res.status, 200, q)
    assert.equal((await res.json()).total, 0)
  }
  assert.equal(await prisma.record.count(), 2)
})

test('GET /records/:id: detalle, 404 y ids hostiles', async () => {
  const ok = await callOne(ids.a)
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).titulo, 'Facturación masiva')

  const missing = await callOne('no-existe')
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error.code, 'not_found')

  for (const evil of ["' OR '1'='1", '../../etc/passwd', '%27--']) {
    assert.equal((await callOne(encodeURIComponent(evil))).status, 404, evil)
  }
  assert.equal((await callOne(ids.a, '?fields=titulo')).status, 200)
  assert.equal((await callOne(ids.a, '?bogus=1')).status, 400)
})

test('GET /records/search: valida q y responde con results', async () => {
  assert.equal((await call(search, '/api/v1/records/search')).status, 400)
  assert.equal((await call(search, '/api/v1/records/search?q=%20%20')).status, 400)
  assert.equal((await call(search, `/api/v1/records/search?q=${'a'.repeat(501)}`)).status, 400)
  const ok = await call(search, '/api/v1/records/search?q=facturacion&limit=5')
  assert.equal(ok.status, 200)
  assert.ok(Array.isArray((await ok.json()).results))
})

test('GET /audit-log exige el scope audit:read', async () => {
  const denied = await call(auditLog, '/api/v1/audit-log')
  assert.equal(denied.status, 403)

  const withAudit = await createApiKey(owner, { name: 'audit', scopes: ['audit:read'] })
  const ok = await call(auditLog, '/api/v1/audit-log', withAudit.token)
  assert.equal(ok.status, 200)
  assert.equal((await call(auditLog, '/api/v1/audit-log?desde=garbage', withAudit.token)).status, 400)
  assert.equal((await call(auditLog, '/api/v1/audit-log?limit=5&recordId=zzz', withAudit.token)).status, 200)
})

test('un token de solo lectura no tiene forma de escribir: POST/PATCH/DELETE no existen en estas rutas', async () => {
  const mod = await import('@/app/api/v1/records/route')
  const one = await import('@/app/api/v1/records/[id]/route')
  assert.equal((mod as Record<string, unknown>).DELETE, undefined)
  assert.equal((one as Record<string, unknown>).DELETE, undefined)
  assert.equal((one as Record<string, unknown>).PATCH, undefined)
})

test('las lecturas por API quedan en la auditoría con el canal y la key', async () => {
  await call(list, '/api/v1/records?tipo=Mejora')
  await callOne(ids.a)
  await call(search, '/api/v1/records/search?q=hola')

  const logs = await prisma.auditLog.findMany({ orderBy: { timestamp: 'asc' } })
  assert.deepEqual(logs.map((l) => l.action), ['API_LISTED_RECORDS', 'API_VIEWED_RECORD', 'API_SEARCHED_RECORDS'])
  assert.equal(logs[1].recordId, ids.a)
  const d = logs[0].details as Record<string, unknown>
  assert.equal(d.via, 'api')
  assert.equal(d.apiKeyId, keyId)
  assert.deepEqual(d.args, { tipo: 'Mejora' })

  // y además en el log de requests del token
  assert.equal(await prisma.apiRequestLog.count({ where: { apiKeyId: keyId } }), 3)
})
