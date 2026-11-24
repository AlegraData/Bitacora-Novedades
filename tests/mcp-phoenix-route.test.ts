import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { SpanStatusCode } from '@opentelemetry/api'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import { POST as mcpPost } from '@/app/api/mcp/route'
import { prisma } from '@/lib/prisma'
import { TOOLS } from '@/lib/mcp/tools'
import {
  ANSWER_RATE_LIMITED_MESSAGE,
  ANSWER_RECORDED,
  ANSWER_TOOL,
  CONVERSATION_INSTRUCTIONS,
  INVALID_ANSWER_MESSAGE,
  MISSING_QUESTION_MESSAGE,
  QUESTION_PARAM,
} from '@/lib/mcp/conversation'
import { CHAIN_SPAN_NAME, createTracing, setTracingForTests } from '@/lib/mcp/tracing'
import { resetDb, makeUser, ensureFields } from './helpers'

// Phoenix con un exportador en memoria (sin red) y en modo full: lo más expuesto posible,
// para comprobar qué sale y qué no.
const exporter = new InMemorySpanExporter()
setTracingForTests(createTracing({ PHOENIX_CAPTURE_MODE: 'full' }, exporter))
after(() => setTracingForTests(undefined))

const FLAGS = ['MCP_CAPTURE_CONVERSATION', 'MCP_REQUIRE_QUESTION'] as const
function flags(values: Partial<Record<(typeof FLAGS)[number], string>>) {
  for (const k of FLAGS) {
    if (values[k] === undefined) delete process.env[k]
    else process.env[k] = values[k]
  }
}

beforeEach(async () => {
  await resetDb()
  await prisma.oAuthSession.deleteMany()
  await ensureFields()
  exporter.reset()
  flags({ MCP_CAPTURE_CONVERSATION: 'true' })
})
afterEach(() => flags({}))

async function session(email: string, role: 'ADMIN' | 'MANAGER' | 'VIEWER', clientName: string | null = 'Claude') {
  await makeUser(email, role)
  const token = `tok-${email}`
  await prisma.oAuthSession.create({
    data: { accessToken: token, refreshToken: `ref-${email}`, userEmail: email, clientId: 'c1', clientName, expiresAt: new Date(Date.now() + 3_600_000), refreshExpiresAt: new Date(Date.now() + 86_400_000) },
  })
  return token
}

async function rpc(token: string, method: string, params: Record<string, unknown> = {}) {
  const res = await mcpPost(
    new NextRequest('http://localhost/api/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'claude-ai/test' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
  )
  return { status: res.status, body: await res.json() }
}

type ToolReply = { content: { type: string; text: string }[]; isError?: boolean }
const callTool = async (token: string, name: string, args: Record<string, unknown>) => rpc(token, 'tools/call', { name, arguments: args })
const replyText = (r: { body: { result: ToolReply } }) => r.body.result.content[0].text

function lastTrace() {
  const all = exporter.getFinishedSpans()
  const chain = [...all].reverse().find((s) => s.name === CHAIN_SPAN_NAME)!
  const tool = [...all].reverse().find((s) => s.name !== CHAIN_SPAN_NAME)!
  return { chain, tool, meta: JSON.parse(String(chain.attributes.metadata)) as Record<string, unknown> }
}

/** Todo lo que quedó en la base de lo que registra una llamada (auditoría y registro del admin). */
async function storedText() {
  const [audit, calls] = await Promise.all([prisma.auditLog.findMany(), prisma.mcpToolCall.findMany()])
  return JSON.stringify({ audit, calls })
}

test('con la captura apagada todo queda como antes: sin instrucciones, sin pregunta_usuario y sin registrar_respuesta', async () => {
  flags({})
  const token = await session('ana@alegra.com', 'VIEWER')
  const init = await rpc(token, 'initialize')
  assert.equal(init.body.result.instructions, undefined)
  const list = await rpc(token, 'tools/list')
  const tools = list.body.result.tools as { name: string; inputSchema: { properties: Record<string, unknown> } }[]
  assert.deepEqual(tools.map((t) => t.name), TOOLS.map((t) => t.name))
  for (const t of tools) assert.equal(t.inputSchema.properties[QUESTION_PARAM], undefined, t.name)
  const answer = await callTool(token, ANSWER_TOOL, { respuesta: 'x' })
  assert.equal(answer.body.error.code, -32601, 'registrar_respuesta no existe')

  // Aun apagada, una pregunta que llegue se retira antes de ejecutar y de auditar.
  const r = await callTool(token, 'list_records', { limit: 5, [QUESTION_PARAM]: 'pregunta con la captura apagada' })
  assert.equal(r.status, 200)
  assert.ok(!(await storedText()).includes('pregunta con la captura apagada'))
})

test('con la captura activa: instrucciones, pregunta_usuario obligatoria en todas las herramientas y registrar_respuesta', async () => {
  const token = await session('ana@alegra.com', 'VIEWER')
  const init = await rpc(token, 'initialize')
  assert.equal(init.body.result.instructions, CONVERSATION_INSTRUCTIONS)
  const tools = (await rpc(token, 'tools/list')).body.result.tools as { name: string; requiredRole?: string; inputSchema: { required: string[] } }[]
  assert.deepEqual(tools.map((t) => t.name), [...TOOLS.map((t) => t.name), ANSWER_TOOL])
  for (const t of tools) {
    assert.ok(t.inputSchema.required.includes(QUESTION_PARAM), t.name)
    assert.equal(t.requiredRole, undefined, 'el rol requerido no se publica')
  }
})

test('la pregunta nunca llega a la herramienta, la auditoría ni el registro del admin; sí a Phoenix', async () => {
  const question = '¿Qué novedades salieron esta semana? (texto único 7f3a)'
  const token = await session('ana@alegra.com', 'VIEWER', 'Claude Code')
  const r = await callTool(token, 'list_records', { limit: 5, [QUESTION_PARAM]: question })
  assert.equal(r.status, 200)
  assert.equal(r.body.result.isError, undefined)

  const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'MCP_LISTED_RECORDS' } })
  assert.deepEqual((audit.details as { args: unknown }).args, { limit: 5 })
  const row = await prisma.mcpToolCall.findFirstOrThrow()
  assert.deepEqual([row.tool, row.status, row.agent], ['list_records', 'ok', 'Claude Code'])
  assert.ok(!(await storedText()).includes('7f3a'))

  const { chain, tool, meta } = lastTrace()
  assert.equal(chain.attributes['input.value'], question)
  assert.equal(chain.attributes['user.id'], 'ana@alegra.com')
  assert.equal(tool.attributes['tool.name'], 'list_records')
  assert.deepEqual(JSON.parse(String(tool.attributes['input.value'])), { limit: 5 })
  assert.deepEqual([meta.agent, meta.rol, meta.status, meta.user_agent, meta.records_count], ['Claude Code', 'VIEWER', 'OK', 'claude-ai/test', 0])
})

test('registrar_respuesta: texto fijo, no toca la Bitácora y la respuesta solo va a Phoenix', async () => {
  const question = '¿Cuántas novedades hay de POS?'
  const answer = 'Hay 0 novedades de POS registradas (respuesta única 91c2).'
  const token = await session('luis@alegra.com', 'MANAGER')
  const r = await callTool(token, ANSWER_TOOL, { respuesta: answer, [QUESTION_PARAM]: question })
  assert.equal(replyText(r), ANSWER_RECORDED)
  assert.equal(r.body.result.isError, undefined)

  assert.equal(await prisma.auditLog.count(), 0)
  assert.equal(await prisma.record.count(), 0)
  const row = await prisma.mcpToolCall.findFirstOrThrow()
  assert.deepEqual([row.tool, row.status, row.errorMessage], [ANSWER_TOOL, 'ok', null])
  assert.ok(!(await storedText()).includes('91c2'))

  const { chain, meta } = lastTrace()
  assert.equal(chain.attributes['input.value'], question)
  assert.equal(chain.attributes['output.value'], answer)
  assert.equal(meta.respuesta_chars, answer.length)
})

test('registrar_respuesta: argumentos inválidos → error; más de 30 por minuto → denegada', async () => {
  const token = await session('rate@alegra.com', 'VIEWER')
  const bad = await callTool(token, ANSWER_TOOL, { respuesta: 'x', extra: 1 })
  assert.deepEqual([replyText(bad), bad.body.result.isError], [INVALID_ANSWER_MESSAGE, true])
  assert.equal((await prisma.mcpToolCall.findFirstOrThrow()).status, 'error')

  for (let i = 0; i < 30; i++) assert.equal(replyText(await callTool(token, ANSWER_TOOL, { respuesta: `r${i}` })), ANSWER_RECORDED)
  const limited = await callTool(token, ANSWER_TOOL, { respuesta: 'una más' })
  assert.deepEqual([replyText(limited), limited.body.result.isError], [ANSWER_RATE_LIMITED_MESSAGE, true])
  const last = await prisma.mcpToolCall.findFirstOrThrow({ orderBy: { timestamp: 'desc' } })
  assert.equal(last.status, 'denied')
  assert.equal(lastTrace().meta.error_code, 'rate_limited')
})

test('modo estricto: sin pregunta no se ejecuta ni crea nada; con cualquier texto, sí', async () => {
  flags({ MCP_CAPTURE_CONVERSATION: 'true', MCP_REQUIRE_QUESTION: 'true' })
  const token = await session('mara@alegra.com', 'MANAGER')
  const record = { tipo: 'Mejora', titulo: 'Exportar a Excel', fechaLanzamiento: '2026-12-01', elaborado: 'mara@alegra.com' }

  for (const args of [record, { ...record, [QUESTION_PARAM]: '   ' }]) {
    const r = await callTool(token, 'create_record', args)
    assert.deepEqual([replyText(r), r.body.result.isError], [MISSING_QUESTION_MESSAGE, true])
  }
  assert.equal(await prisma.record.count(), 0, 'no se creó nada')
  const denied = await prisma.mcpToolCall.findMany()
  assert.deepEqual(denied.map((c) => c.status), ['denied', 'denied'])
  assert.equal(lastTrace().meta.error_code, 'sin_pregunta')

  const ok = await callTool(token, 'create_record', { ...record, [QUESTION_PARAM]: 'sí' })
  assert.equal(ok.body.result.isError, undefined)
  assert.equal(await prisma.record.count(), 1)
  assert.equal(replyText(await callTool(token, ANSWER_TOOL, { respuesta: 'Creada.' })), ANSWER_RECORDED, 'registrar_respuesta queda exenta')
})

test('rol insuficiente: denegada y sin contenido en Phoenix aunque el modo sea full', async () => {
  const question = 'Borra la novedad vieja (texto único 5b8e)'
  const token = await session('viewer@alegra.com', 'VIEWER')
  const r = await callTool(token, 'delete_record', { id: 'rec12345678', [QUESTION_PARAM]: question })
  assert.deepEqual(JSON.parse(replyText(r)), { error: 'Esta acción requiere rol ADMIN.' })
  assert.equal((await prisma.mcpToolCall.findFirstOrThrow()).status, 'denied')

  const { chain, meta } = lastTrace()
  assert.deepEqual(chain.attributes['tag.tags'], ['Claude', 'DENIED'])
  assert.deepEqual([meta.error_code, meta.pregunta_capturada, meta.record_id], ['forbidden_role', true, 'rec12345678'])
  const all = JSON.stringify(exporter.getFinishedSpans().map((s) => s.attributes))
  assert.ok(!all.includes('5b8e'))
})

test('notify_pmkt fallido: el admin guarda «CÓDIGO: mensaje» y Phoenix el código', async () => {
  const token = await session('ana@alegra.com', 'VIEWER')
  const r = await callTool(token, 'notify_pmkt', { recordId: 'noexiste1234', [QUESTION_PARAM]: 'Comunica la novedad' })
  assert.equal(JSON.parse(replyText(r)).error.code, 'NOT_FOUND')
  const row = await prisma.mcpToolCall.findFirstOrThrow()
  assert.equal(row.status, 'error')
  assert.match(row.errorMessage ?? '', /^NOT_FOUND: /)
  const { tool, meta } = lastTrace()
  assert.deepEqual([meta.error_code, meta.status], ['not_found', 'ERROR'])
  assert.equal(JSON.parse(String(tool.attributes['output.value'])).error.code, 'NOT_FOUND', 'en full se ve el error que recibió el agente')
})

test('excepción de la herramienta: error interno para el agente y traza ERROR con la excepción', async (t) => {
  t.mock.method(console, 'error', () => {})
  const token = await session('ana@alegra.com', 'VIEWER')
  const r = await callTool(token, 'list_audit_log', { desde: 'no-es-una-fecha' })
  assert.deepEqual(r.body.error, { code: -32000, message: 'Internal tool error' })
  const row = await prisma.mcpToolCall.findFirstOrThrow()
  assert.deepEqual([row.status, row.errorMessage], ['error', 'Internal tool error'])
  const { tool, meta } = lastTrace()
  assert.equal(meta.error_code, 'exception')
  assert.equal(tool.status.code, SpanStatusCode.ERROR)
  assert.equal(tool.events[0]?.name, 'exception')
})

test('herramienta inexistente: error de protocolo como antes y sin fila en el admin; en Phoenix, unknown_tool', async () => {
  const token = await session('ana@alegra.com', 'VIEWER')
  const r = await callTool(token, 'no_existe', {})
  assert.equal(r.body.error.code, -32601)
  assert.equal(await prisma.mcpToolCall.count(), 0)
  const { tool, meta } = lastTrace()
  assert.deepEqual([tool.name, meta.error_code], ['unknown_tool', 'unknown_tool'])
})
