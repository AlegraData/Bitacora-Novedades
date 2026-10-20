import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createApiKey } from '@/lib/api/keys'
import { keyLimiter, failedAuthLimiter } from '@/lib/api/rate-limit'
import { POST as create } from '@/app/api/v1/records/route'
import { GET as getOne, PATCH as patch, DELETE as del } from '@/app/api/v1/records/[id]/route'
import { POST as notify } from '@/app/api/v1/records/[id]/notify-pmkt/route'
import { resetDb, makeUser, ensureFields } from './helpers'

type Role = 'ADMIN' | 'MANAGER' | 'VIEWER'
const base = { tipo: 'Novedad', titulo: 'Original', fechaLanzamiento: '2026-01-01', elaborado: 'ana@alegra.com' }

async function actor(email: string, role: Role, scopes: string[]) {
  await makeUser(email, role)
  return (await createApiKey({ email, role }, { name: email, scopes })).token
}

function send(
  fn: (r: NextRequest, c?: never) => Promise<Response>,
  t: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
) {
  const h: Record<string, string> = { authorization: `Bearer ${t}`, ...headers }
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers: h }
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
    h['content-type'] ??= 'application/json'
  }
  const id = path.split('/')[4]
  return fn(new NextRequest(`http://localhost${path}`, init), { params: Promise.resolve({ id }) } as never)
}

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  keyLimiter.reset()
  failedAuthLimiter.reset()
})

test('POST /records crea la novedad a nombre del dueño del token y audita el canal api', async () => {
  const t = await actor('ana@alegra.com', 'VIEWER', ['records:write'])
  const res = await send(create, t, 'POST', '/api/v1/records', base)
  assert.equal(res.status, 201)
  const rec = await res.json()
  assert.equal(rec.titulo, 'Original')
  assert.equal(rec.createdByEmail, 'ana@alegra.com')

  const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'CREATED_RECORD' } })
  assert.equal((log.details as Record<string, unknown>).via, 'api')
  assert.equal(log.recordId, rec.id)
})

test('POST /records: validaciones → 400 con detalle; no se crea nada', async () => {
  const t = await actor('ana@alegra.com', 'VIEWER', ['records:write'])
  const missing = await send(create, t, 'POST', '/api/v1/records', { titulo: 'x' })
  assert.equal(missing.status, 400)

  const badOption = await send(create, t, 'POST', '/api/v1/records', { ...base, tipo: 'Inventado' })
  assert.equal(badOption.status, 400)
  assert.equal((await badOption.json()).error.details[0].field, 'tipo')

  const unknownField = await send(create, t, 'POST', '/api/v1/records', { ...base, campoFalso: 1 })
  assert.equal(unknownField.status, 400)
  assert.equal(await prisma.record.count(), 0)
})

test('POST /records: body hostil → 400/413/415 sin romper', async () => {
  const t = await actor('ana@alegra.com', 'VIEWER', ['records:write'])
  assert.equal((await send(create, t, 'POST', '/api/v1/records', '{no es json')).status, 400)
  assert.equal((await send(create, t, 'POST', '/api/v1/records', '[1,2]')).status, 400)
  assert.equal((await send(create, t, 'POST', '/api/v1/records', 'null')).status, 400)
  assert.equal((await send(create, t, 'POST', '/api/v1/records', '"texto"')).status, 400)
  assert.equal((await send(create, t, 'POST', '/api/v1/records', JSON.stringify(base), { 'content-type': 'text/plain' })).status, 415)
  const huge = JSON.stringify({ ...base, breveDescripcion: 'x'.repeat(1_100_000) })
  assert.equal((await send(create, t, 'POST', '/api/v1/records', huge)).status, 413)
  // claves de prototipo se tratan como campos desconocidos, no contaminan el objeto
  const proto = await send(create, t, 'POST', '/api/v1/records', '{"__proto__":{"admin":true},"constructor":1}')
  assert.equal(proto.status, 400)
  assert.equal(({} as Record<string, unknown>).admin, undefined)
  assert.equal(await prisma.record.count(), 0)
})

test('un token de solo lectura recibe 403 en POST/PATCH/DELETE/notify', async () => {
  const ro = await actor('ro@alegra.com', 'ADMIN', ['records:read'])
  assert.equal((await send(create, ro, 'POST', '/api/v1/records', base)).status, 403)
  assert.equal((await send(patch, ro, 'PATCH', '/api/v1/records/abc', { titulo: 'x' })).status, 403)
  assert.equal((await send(del, ro, 'DELETE', '/api/v1/records/abc')).status, 403)
  assert.equal((await send(notify, ro, 'POST', '/api/v1/records/abc/notify-pmkt', {})).status, 403)
  assert.equal(await prisma.record.count(), 0)
})

test('PATCH: el autor edita lo suyo; otro usuario no; un ADMIN sí; el id sale de la URL', async () => {
  const ana = await actor('ana@alegra.com', 'VIEWER', ['records:write', 'records:read'])
  const eva = await actor('eva@alegra.com', 'VIEWER', ['records:write'])
  const adm = await actor('adm@alegra.com', 'ADMIN', ['records:write'])

  const { id } = await (await send(create, ana, 'POST', '/api/v1/records', base)).json()
  const other = await (await send(create, ana, 'POST', '/api/v1/records', { ...base, titulo: 'Otro' })).json()

  const own = await send(patch, ana, 'PATCH', `/api/v1/records/${id}`, { titulo: 'Editado' })
  assert.equal(own.status, 200)
  assert.equal((await own.json()).titulo, 'Editado')

  const denied = await send(patch, eva, 'PATCH', `/api/v1/records/${id}`, { titulo: 'Hack' })
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).error.code, 'forbidden')

  assert.equal((await send(patch, adm, 'PATCH', `/api/v1/records/${id}`, { titulo: 'Por admin' })).status, 200)

  // un "id" en el body no redirige la edición a otro registro
  await send(patch, ana, 'PATCH', `/api/v1/records/${id}`, { id: other.id, titulo: 'Solo yo' })
  const a = await (await send(getOne, ana, 'GET', `/api/v1/records/${id}`)).json()
  const b = await (await send(getOne, ana, 'GET', `/api/v1/records/${other.id}`)).json()
  assert.equal(a.titulo, 'Solo yo')
  assert.equal(b.titulo, 'Otro')

  assert.equal((await send(patch, ana, 'PATCH', '/api/v1/records/no-existe', { titulo: 'x' })).status, 404)
  assert.equal((await send(patch, ana, 'PATCH', `/api/v1/records/${id}`, { tipo: 'Inventado' })).status, 400)
})

test('PATCH: listas se combinan por defecto y replaceArrays las reemplaza', async () => {
  const t = await actor('ana@alegra.com', 'VIEWER', ['records:write', 'records:read'])
  const { id } = await (await send(create, t, 'POST', '/api/v1/records', { ...base, producto: ['Alegra POS'] })).json()
  const merged = await (await send(patch, t, 'PATCH', `/api/v1/records/${id}`, { producto: ['Alegra Nómina'] })).json()
  assert.deepEqual(merged.producto.sort(), ['Alegra Nómina', 'Alegra POS'])
  const replaced = await (await send(patch, t, 'PATCH', `/api/v1/records/${id}`, { producto: ['Alegra POS'], replaceArrays: true })).json()
  assert.deepEqual(replaced.producto, ['Alegra POS'])
})

test('DELETE: exige scope Y rol ADMIN vigente del dueño; 404 si no existe; audita', async () => {
  const adm = await actor('adm@alegra.com', 'ADMIN', ['records:write', 'records:delete'])
  const { id } = await (await send(create, adm, 'POST', '/api/v1/records', base)).json()

  // el dueño pierde el rol ADMIN → el token con scope de borrado deja de poder borrar
  await prisma.user.update({ where: { email: 'adm@alegra.com' }, data: { role: 'VIEWER' } })
  const blocked = await send(del, adm, 'DELETE', `/api/v1/records/${id}`)
  assert.equal(blocked.status, 403)
  assert.equal(await prisma.record.count(), 1)

  await prisma.user.update({ where: { email: 'adm@alegra.com' }, data: { role: 'ADMIN' } })
  assert.equal((await send(del, adm, 'DELETE', `/api/v1/records/${id}`)).status, 200)
  assert.equal(await prisma.record.count(), 0)
  assert.equal((await send(del, adm, 'DELETE', `/api/v1/records/${id}`)).status, 404)

  const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'DELETED_RECORD' } })
  assert.equal((log.details as Record<string, unknown>).via, 'api')
})

test('notify-pmkt: tipo no aplicable → 400; confirm no booleano → 400; id inexistente → 404; nunca envía', async () => {
  const t = await actor('ana@alegra.com', 'VIEWER', ['records:write', 'pmkt:notify'])
  const mejora = await (await send(create, t, 'POST', '/api/v1/records', { ...base, tipo: 'Mejora' })).json()
  const res = await send(notify, t, 'POST', `/api/v1/records/${mejora.id}/notify-pmkt`, {})
  assert.equal(res.status, 400)
  assert.match((await res.json()).error.message, /no se comunica a PMKT/)

  const bad = await send(notify, t, 'POST', `/api/v1/records/${mejora.id}/notify-pmkt`, { confirm: 'true' })
  assert.equal(bad.status, 400)

  assert.equal((await send(notify, t, 'POST', '/api/v1/records/no-existe/notify-pmkt', {})).status, 404)
  assert.equal(await prisma.auditLog.count({ where: { action: 'NOTIFIED_PMKT' } }), 0)
})
