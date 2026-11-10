import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST as mcpPost } from '@/app/api/mcp/route'
import { agentOf, AGENTS } from '@/lib/admin/agents'
import { statusOfResult } from '@/lib/mcp/call-log'
import { prisma } from '@/lib/prisma'
import { resetDb, makeUser, ensureFields } from './helpers'

test('agentOf: clasifica el cliente por su nombre; lo desconocido es «Otro agente»', () => {
  assert.deepEqual([...AGENTS], ['Claude', 'Claude Code', 'opencode', 'Otro agente'])
  for (const [name, agent] of [
    ['Claude', 'Claude'], ['claude.ai', 'Claude'], ['Claude Code', 'Claude Code'], ['claude-code', 'Claude Code'], ['claude_code (vscode)', 'Claude Code'],
    ['opencode', 'opencode'], ['OpenCode', 'opencode'], ['hermes-agent/0.23.0', 'Otro agente'], ['', 'Otro agente'], [null, 'Otro agente'], [undefined, 'Otro agente'],
  ] as const) assert.equal(agentOf(name), agent, String(name))
})

test('statusOfResult: sin error = ok; permisos = denegada; cualquier otro error = error', () => {
  assert.deepEqual(statusOfResult({ records: [] }), { status: 'ok', message: null })
  assert.deepEqual(statusOfResult(null), { status: 'ok', message: null })
  assert.equal(statusOfResult({ error: 'Esta acción requiere rol ADMIN.' }).status, 'denied')
  assert.equal(statusOfResult({ error: 'No tienes permiso para editar este campo' }).status, 'denied')
  assert.equal(statusOfResult({ error: 'El campo titulo es obligatorio' }).status, 'error')
})

beforeEach(async () => {
  await resetDb()
  await prisma.oAuthSession.deleteMany()
  await ensureFields()
})

async function session(email: string, role: 'ADMIN' | 'VIEWER', clientName: string | null) {
  await makeUser(email, role)
  const token = `tok-${email}`
  const s = await prisma.oAuthSession.create({
    data: { accessToken: token, refreshToken: `ref-${email}`, userEmail: email, clientId: 'c1', clientName, expiresAt: new Date(Date.now() + 3_600_000), refreshExpiresAt: new Date(Date.now() + 86_400_000) },
  })
  return { token, id: s.id }
}

const call = (token: string, name: string, args: Record<string, unknown> = {}) =>
  mcpPost(new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }))

test('cada llamada a una herramienta queda registrada: persona, agente, herramienta, resultado y duración', async () => {
  const s = await session('ana@alegra.com', 'VIEWER', 'Claude Code')
  assert.equal((await call(s.token, 'list_records', { limit: 5 })).status, 200)
  const row = await prisma.mcpToolCall.findFirstOrThrow()
  assert.deepEqual([row.userEmail, row.agent, row.clientName, row.tool, row.status, row.sessionId], ['ana@alegra.com', 'Claude Code', 'Claude Code', 'list_records', 'ok', s.id])
  assert.ok(row.durationMs >= 0)
})

test('una herramienta que exige otro rol se registra como denegada; el id del registro se guarda, el contenido no', async () => {
  const s = await session('viewer@alegra.com', 'VIEWER', 'opencode')
  await call(s.token, 'delete_record', { id: 'rec123', secreto: 'no debe guardarse' })
  const row = await prisma.mcpToolCall.findFirstOrThrow()
  assert.deepEqual([row.status, row.agent, row.tool, row.recordId], ['denied', 'opencode', 'delete_record', 'rec123'])
  assert.ok(!JSON.stringify(row).includes('no debe guardarse'))
})

test('sin autenticación no se registra nada; una herramienta inexistente tampoco', async () => {
  assert.equal((await call('token-invalido', 'list_records')).status, 401)
  const s = await session('ana@alegra.com', 'VIEWER', null)
  await call(s.token, 'no_existe')
  assert.equal(await prisma.mcpToolCall.count(), 0)
})
