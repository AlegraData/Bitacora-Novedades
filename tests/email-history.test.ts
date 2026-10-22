import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { listDeliveries } from '@/lib/email/history'
import { handleListEmailDeliveries, TOOLS } from '@/lib/mcp/tools'
import type { Caller } from '@/lib/mcp/auth'
import { createApiKey } from '@/lib/api/keys'
import { keyLimiter, failedAuthLimiter } from '@/lib/api/rate-limit'
import { GET as perRecord } from '@/app/api/v1/records/[id]/email-deliveries/route'
import { GET as all } from '@/app/api/v1/email-deliveries/route'
import { resetDb, makeUser, ensureFields } from './helpers'

const base = { channel: 'web', trigger: 'manual', triggeredByEmail: 'ana@alegra.com', mode: 'live' }

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  keyLimiter.reset()
  failedAuthLimiter.reset()
  await prisma.emailDelivery.createMany({
    data: [
      { ...base, recordId: 'rec1', status: 'sent', subject: 'A', recipients: ['x@alegra.com'], html: '<p>secreto</p>', messageId: '<m1@x>', lockKey: 'novedad:rec1' },
      { ...base, recordId: 'rec1', status: 'failed', errorCode: 'SMTP_AUTH', errorMessage: 'No se pudo autenticar', errorDetail: '535 detalle técnico', createdAt: new Date(Date.now() - 1000) },
      { ...base, recordId: 'rec2', status: 'simulated', mode: 'simulate', subject: 'B' },
      { ...base, recordId: 'rec2', status: 'sent', mode: 'webhook', legacyResponse: '200 {"status":"success"}', lockKey: 'novedad:rec2' },
    ],
  })
})

test('lista con filtros por novedad, estado y modo; orden más reciente primero', async () => {
  assert.equal((await listDeliveries('VIEWER')).total, 4)
  const r1 = await listDeliveries('VIEWER', { recordId: 'rec1' })
  assert.equal(r1.total, 2)
  assert.equal(r1.deliveries[0].status, 'sent', 'el más reciente primero')
  assert.equal((await listDeliveries('VIEWER', { status: 'failed' })).total, 1)
  assert.equal((await listDeliveries('VIEWER', { mode: 'webhook' })).total, 1)
  assert.equal((await listDeliveries('VIEWER', { status: 'inventado' })).total, 4, 'filtro inválido se ignora, no rompe')
  assert.equal((await listDeliveries('VIEWER', { recordId: { $ne: 1 } })).total, 4)
})

test('paginación acotada', async () => {
  const p = await listDeliveries('VIEWER', { limit: 1, offset: 1 })
  assert.equal(p.deliveries.length, 1)
  assert.equal(p.total, 4)
  assert.equal((await listDeliveries('VIEWER', { limit: 99999 })).limit, 200)
  assert.equal((await listDeliveries('VIEWER', { limit: -5, offset: -9 })).offset, 0)
})

test('un usuario normal no ve detalle técnico, respuesta del Apps Script, messageId ni el HTML; un ADMIN sí', async () => {
  const user = JSON.stringify(await listDeliveries('VIEWER'))
  for (const secret of ['535 detalle técnico', '<p>secreto</p>', '<m1@x>', 'success']) assert.ok(!user.includes(secret), `un VIEWER vio: ${secret}`)
  assert.ok(user.includes('No se pudo autenticar'), 'el motivo legible sí')

  const adm = JSON.stringify(await listDeliveries('ADMIN'))
  assert.ok(adm.includes('535 detalle técnico') && adm.includes('<m1@x>') && adm.includes('success'))
  assert.ok(!adm.includes('<p>secreto</p>'), 'el HTML solo con includeHtml explícito')
})

test('MCP list_email_deliveries: existe como tool, filtra y respeta el rol', async () => {
  assert.ok(TOOLS.some((t) => t.name === 'list_email_deliveries'))
  const mk = async (email: string, role: 'ADMIN' | 'VIEWER'): Promise<Caller> => {
    const u = await makeUser(email, role)
    return { id: u.id, email, name: u.name, role }
  }
  const viewer = (await handleListEmailDeliveries({ recordId: 'rec1' }, await mk('v@alegra.com', 'VIEWER'))) as { total: number; deliveries: { errorDetail?: string }[] }
  assert.equal(viewer.total, 2)
  assert.ok(viewer.deliveries.every((d) => d.errorDetail === undefined))
  const admin = (await handleListEmailDeliveries({ recordId: 'rec1' }, await mk('a@alegra.com', 'ADMIN'))) as { deliveries: { errorDetail?: string | null }[] }
  assert.ok(admin.deliveries.some((d) => d.errorDetail === '535 detalle técnico'))
})

test('API: por novedad con records:read; global solo con audit:read; filtros inválidos → 400; las lecturas se auditan', async () => {
  await makeUser('svc@alegra.com', 'VIEWER')
  const read = (await createApiKey({ email: 'svc@alegra.com', role: 'VIEWER' }, { name: 'r', scopes: ['records:read'] })).token
  const audit = (await createApiKey({ email: 'svc@alegra.com', role: 'VIEWER' }, { name: 'a', scopes: ['audit:read'] })).token
  const req = (path: string, t: string) => new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${t}` } })
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

  const ok = await perRecord(req('/api/v1/records/rec1/email-deliveries', read), ctx('rec1'))
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).total, 2)

  assert.equal((await perRecord(req('/api/v1/records/rec1/email-deliveries?foo=1', read), ctx('rec1'))).status, 400)
  assert.equal((await perRecord(req('/api/v1/records/rec1/email-deliveries?limit=abc', read), ctx('rec1'))).status, 400)
  assert.equal((await perRecord(req('/api/v1/records/%00/email-deliveries', read), ctx('\u0000'))).status, 404)

  const noScope = await all(req('/api/v1/email-deliveries', read), ctx(''))
  assert.equal(noScope.status, 403)
  const global = await all(req('/api/v1/email-deliveries?status=failed', audit), ctx(''))
  assert.equal(global.status, 200)
  assert.equal((await global.json()).total, 1)

  const logs = await prisma.auditLog.findMany({ where: { action: 'API_LISTED_EMAIL_DELIVERIES' } })
  assert.equal(logs.length, 2)
})
