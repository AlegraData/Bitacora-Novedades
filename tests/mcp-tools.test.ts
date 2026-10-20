import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { handleCreateRecord, handleUpdateRecord, handleDeleteRecord, handleListRecords } from '@/lib/mcp/tools'
import type { Caller } from '@/lib/mcp/auth'
import { resetDb, makeUser, ensureFields } from './helpers'

let mcpCaller: Caller
let apiCaller: Caller

const base = { tipo: 'Novedad', titulo: 'T', fechaLanzamiento: '2026-01-01', elaborado: 'p@alegra.com' }

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  const u = await makeUser('p@alegra.com', 'ADMIN')
  mcpCaller = { id: u.id, email: u.email, name: u.name, role: 'ADMIN' }
  apiCaller = { ...mcpCaller, via: { channel: 'api', apiKeyId: 'key1', apiKeyName: 'Apps Script' } }
})

test('auditoría distingue el canal: MCP vs API (con apiKeyId)', async () => {
  const viaMcp = (await handleCreateRecord(base, mcpCaller)) as { id: string }
  const viaApi = (await handleCreateRecord({ ...base, titulo: 'T2' }, apiCaller)) as { id: string }
  await handleUpdateRecord({ id: viaApi.id, titulo: 'T3' }, apiCaller)
  await handleDeleteRecord({ id: viaApi.id }, apiCaller)

  const logs = await prisma.auditLog.findMany({ orderBy: { timestamp: 'asc' } })
  const d = (i: number) => logs[i].details as Record<string, unknown>
  assert.equal(logs.length, 4)
  assert.equal(logs[0].recordId, viaMcp.id)
  assert.deepEqual(d(0), { via: 'mcp', tool: 'create_record' })
  assert.deepEqual(d(1), { via: 'api', tool: 'create_record', apiKeyId: 'key1', apiKeyName: 'Apps Script' })
  assert.equal(d(2).via, 'api')
  assert.equal((d(2).changedFields as string[]).length, 1)
  assert.equal(d(3).tool, 'delete_record')
})

test('list_records: filtros por proyectoLinear y fecha real de producción', async () => {
  await handleCreateRecord({ ...base, titulo: 'A', proyectoLinear: 'https://linear.app/alegra/project/Mejoras-ABC', fechaProduccion: '2026-03-10' }, mcpCaller)
  await handleCreateRecord({ ...base, titulo: 'B', proyectoLinear: 'ITDATA-4582', fechaProduccion: '2026-05-01' }, mcpCaller)
  await handleCreateRecord({ ...base, titulo: 'C' }, mcpCaller)

  const titles = (r: Record<string, unknown>) => (r.records as { titulo: string }[]).map((x) => x.titulo).sort()

  assert.deepEqual(titles(await handleListRecords({ proyectoLinear: 'itdata-4582' })), ['B'])
  assert.deepEqual(titles(await handleListRecords({ proyectoLinear: 'mejoras-abc' })), ['A'])
  assert.deepEqual(titles(await handleListRecords({ proyectoLinear: 'no-existe' })), [])
  assert.deepEqual(titles(await handleListRecords({ fechaProduccionDesde: '2026-03-01' })), ['A', 'B'])
  assert.deepEqual(titles(await handleListRecords({ fechaProduccionDesde: '2026-04-01', fechaProduccionHasta: '2026-06-01' })), ['B'])
  assert.deepEqual(titles(await handleListRecords({ proyectoLinear: '   ' })), ['A', 'B', 'C'], 'filtro vacío se ignora')
})
