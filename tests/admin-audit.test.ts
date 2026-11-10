import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/prisma'
import { queryAuditLogs } from '@/lib/admin/audit'
import { resetDb } from './helpers'

beforeEach(async () => {
  await resetDb()
  const base = Date.now()
  for (let i = 0; i < 27; i++) {
    await prisma.auditLog.create({
      data: {
        timestamp: new Date(base - i * 1000),
        userEmail: i % 3 === 0 ? 'tomas.lopera@alegra.com' : 'ana@alegra.com',
        userName: i % 3 === 0 ? 'Tomás Lopera' : 'Ana',
        action: i % 9 === 0 ? 'MCP_VIEWED_RECORD' : 'UPDATED_RECORD',
        recordId: `rec${i}`,
        details: i % 9 === 0 ? { via: 'mcp', tool: 'get_record' } : i % 2 === 0 ? { via: 'api', tool: 'update_record' } : undefined,
      },
    })
  }
})

test('pagina en la base: 10 por página por defecto, total y rangos correctos, más recientes primero', async () => {
  const p1 = await queryAuditLogs({})
  assert.deepEqual([p1.rows.length, p1.total, p1.pageCount, p1.from, p1.to, p1.pageSize], [10, 27, 3, 1, 10, 10])
  assert.equal(p1.rows[0].recordId, 'rec0', 'la más reciente primero')
  const p3 = await queryAuditLogs({ page: 3 })
  assert.deepEqual([p3.rows.length, p3.from, p3.to], [7, 21, 27])
  assert.equal((await queryAuditLogs({ page: 99 })).page, 3, 'página inexistente → la última')
  assert.equal((await queryAuditLogs({ pageSize: 20 })).rows.length, 20)
  assert.equal((await queryAuditLogs({ pageSize: 50 })).rows.length, 27)
  assert.equal((await queryAuditLogs({ pageSize: 7 })).pageSize, 10, 'tamaño no permitido → 10')
})

test('busca por usuario (sin importar tildes de mayúsculas), correo, acción o ID', async () => {
  assert.equal((await queryAuditLogs({ q: 'tomás' })).total, 9)
  assert.equal((await queryAuditLogs({ q: 'TOMAS.LOPERA' })).total, 9)
  assert.equal((await queryAuditLogs({ q: 'mcp_viewed' })).total, 3)
  assert.equal((await queryAuditLogs({ q: 'rec26' })).total, 1)
  assert.equal((await queryAuditLogs({ q: 'tomás mcp_viewed' })).total, 3, 'todas las palabras')
  assert.equal((await queryAuditLogs({ q: 'no-existe' })).total, 0)
})

test('filtra por acción y por origen (MCP / API) y lista las acciones existentes', async () => {
  const a = await queryAuditLogs({ action: 'MCP_VIEWED_RECORD' })
  assert.equal(a.total, 3)
  assert.deepEqual(a.actions, ['MCP_VIEWED_RECORD', 'UPDATED_RECORD'])
  const mcp = await queryAuditLogs({ via: 'mcp' })
  assert.equal(mcp.total, 3)
  assert.ok(mcp.rows.every((r) => r.via === 'mcp' && r.tool === 'get_record'))
  const api = await queryAuditLogs({ via: 'api' })
  assert.ok(api.total > 0 && api.rows.every((r) => r.via === 'api'))
  assert.equal((await queryAuditLogs({ via: 'inventado' })).total, 27, 'origen desconocido se ignora')
})

test('la acción del panel exige ADMIN', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/actions/admin-data.ts'), 'utf8')
  for (const body of src.split(/\nexport async function /).slice(1)) assert.match(body.slice(0, body.indexOf('\n}\n')), /requireAdmin\(\)/)
})
