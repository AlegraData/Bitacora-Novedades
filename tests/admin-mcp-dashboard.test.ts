import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { getMcpOverview, getMcpActivity, clampPeriod, dayKey } from '@/lib/admin/mcp-dashboard'
import { resetDb, makeUser, ensureFields } from './helpers'
import { makeRecord } from './email-helpers'

const NOW = Date.now()
const H = 3_600_000
const D = 24 * H

async function session(email: string, clientName: string | null, over: Record<string, unknown> = {}) {
  return prisma.oAuthSession.create({
    data: {
      accessToken: `a-${Math.random()}`, refreshToken: `r-${Math.random()}`, userEmail: email, clientId: 'c', clientName,
      expiresAt: new Date(NOW + H), refreshExpiresAt: new Date(NOW + 30 * D), lastUsedAt: new Date(NOW - 5 * 60_000), ...over,
    },
  })
}
async function call(email: string, sessionId: string | null, agent: string, tool: string, status: string, hoursAgo: number, recordId: string | null = null) {
  await prisma.mcpToolCall.create({ data: { userEmail: email, sessionId, clientName: agent, agent, tool, status, recordId, durationMs: 12, timestamp: new Date(NOW - hoursAgo * H) } })
}

beforeEach(async () => {
  await resetDb()
  await prisma.oAuthSession.deleteMany()
  await ensureFields()
})

test('clampPeriod: 7, 30 o 90 días; cualquier otro valor vuelve a 7', () => {
  for (const ok of [7, 30, 90, '30']) assert.equal(clampPeriod(ok), Number(ok))
  for (const bad of [0, 1, 14, 365, 'x', null, undefined]) assert.equal(clampPeriod(bad), 7, String(bad))
})

test('resumen: personas y conexiones vigentes, resultados, agentes y llamadas por día', async () => {
  await makeUser('ana@alegra.com', 'VIEWER')
  const a1 = await session('ana@alegra.com', 'Claude Code')
  const a2 = await session('ana@alegra.com', 'hermes-agent/0.23.0')
  const b1 = await session('beto@alegra.com', 'opencode')
  await session('caro@alegra.com', 'Claude', { revokedAt: new Date(NOW - H) }) // revocada: no cuenta como vigente
  await call('ana@alegra.com', a1.id, 'Claude Code', 'list_records', 'ok', 1)
  await call('ana@alegra.com', a1.id, 'Claude Code', 'get_record', 'ok', 2)
  await call('ana@alegra.com', a2.id, 'Otro agente', 'delete_record', 'denied', 3)
  await call('beto@alegra.com', b1.id, 'opencode', 'update_record', 'error', 30)
  await call('beto@alegra.com', b1.id, 'opencode', 'list_records', 'ok', 24 * 20) // fuera de 7 días

  const o = await getMcpOverview(7, NOW)
  assert.deepEqual([o.people, o.activeConnections, o.calls], [2, 3, 4])
  assert.deepEqual(o.results, { ok: 2, denied: 1, error: 1 })
  assert.deepEqual(o.byAgent, [{ agent: 'Claude Code', count: 1 }, { agent: 'opencode', count: 1 }, { agent: 'Otro agente', count: 1 }])
  assert.equal(o.perDay.length, 7)
  assert.equal(o.perDay.reduce((n, d) => n + d.value, 0), 4)
  assert.equal(o.perDay.at(-1)!.date, dayKey(new Date(NOW)))
  assert.ok(o.trackingSince)

  const ana = o.rows.find((r) => r.email === 'ana@alegra.com')!
  assert.deepEqual([ana.activeConnections, ana.calls, ana.connections.length], [2, 3, 2])
  assert.deepEqual(ana.connections.find((c) => c.id === a1.id)!.calls, 2)
  assert.ok(ana.lastUsedAt)
  const caro = o.rows.find((r) => r.email === 'caro@alegra.com')!
  assert.deepEqual([caro.activeConnections, caro.connections[0].status], [0, 'revoked'], 'sigue en la lista para «incluir sin conexión vigente»')

  assert.equal((await getMcpOverview(30, NOW)).calls, 5, 'con 30 días entra la llamada de hace 20')
})

test('actividad: paginada, con filtros por resultado, herramienta y persona (por nombre o correo)', async () => {
  await makeUser('ana@alegra.com', 'VIEWER')
  const rec = await makeRecord({ titulo: 'Facturación masiva' })
  for (let i = 0; i < 23; i++) await call(i % 2 ? 'ana@alegra.com' : 'beto@alegra.com', null, 'Claude', i % 5 === 0 ? 'get_record' : 'list_records', i % 7 === 0 ? 'denied' : 'ok', i + 1, i === 0 ? rec.id : null)

  const p1 = await getMcpActivity({}, NOW)
  assert.deepEqual([p1.rows.length, p1.total, p1.pageCount, p1.pageSize], [10, 23, 3, 10])
  assert.equal(p1.rows[0].recordTitle, 'Facturación masiva', 'la más reciente trae el título de la novedad')
  assert.deepEqual(p1.tools, ['get_record', 'list_records'])
  assert.equal((await getMcpActivity({ page: 3 }, NOW)).rows.length, 3)
  assert.equal((await getMcpActivity({ pageSize: 50 }, NOW)).rows.length, 23)
  assert.equal((await getMcpActivity({ status: 'denied' }, NOW)).total, 4)
  assert.equal((await getMcpActivity({ tool: 'get_record' }, NOW)).total, 5)
  assert.equal((await getMcpActivity({ q: 'ana@' }, NOW)).total, 11)
  assert.equal((await getMcpActivity({ q: 'ANA' }, NOW)).total, 11, 'por nombre o correo, sin importar mayúsculas')
  assert.equal((await getMcpActivity({ q: 'zzz' }, NOW)).total, 0)
  assert.equal((await getMcpActivity({ status: 'inventado' }, NOW)).total, 23)
})
