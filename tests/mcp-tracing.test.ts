import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SpanStatusCode } from '@opentelemetry/api'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import {
  CHAIN_SPAN_NAME,
  SECRET_MASK,
  createTracing,
  emitToolSpans,
  errorCodeOf,
  maskSecrets,
  parseCaptureMode,
  parseMaxContent,
  questionId,
  redactArguments,
  resultSummary,
  sessionIdFor,
  traceStatusOf,
  type ToolCallTrace,
  type Tracing,
} from '@/lib/mcp/tracing'

function setup(env: Record<string, string> = {}) {
  const exporter = new InMemorySpanExporter()
  const t = createTracing({ PHOENIX_CAPTURE_MODE: 'full', ...env }, exporter)
  assert.ok(t)
  return { t: t as Tracing, exporter }
}

const QUESTION = '¿Qué novedades de facturación salieron este mes?'
const RESULT = {
  total: 2,
  limit: 5,
  offset: 0,
  records: [
    { id: 'rec00000001', titulo: 'Factura electrónica en POS' },
    { id: 'rec00000002', titulo: 'Notas crédito masivas' },
  ],
}

function call(overrides: Partial<ToolCallTrace> = {}): ToolCallTrace {
  return {
    userEmail: 'Ana@Alegra.com',
    sessionId: 'cmsession123456',
    clientName: 'Claude',
    role: 'MANAGER',
    userAgent: 'claude-ai/1.0\r\ninyectado',
    tool: 'list_records',
    args: { query: 'facturación', limit: 5 },
    question: QUESTION,
    status: 'ok',
    detail: null,
    startedAt: Date.parse('2026-11-24T15:00:00Z'),
    durationMs: 42,
    result: RESULT,
    resultText: JSON.stringify(RESULT),
    ...overrides,
  }
}

function spans(exporter: InMemorySpanExporter) {
  const all = exporter.getFinishedSpans()
  const chains = all.filter((s) => s.name === CHAIN_SPAN_NAME)
  const tools = all.filter((s) => s.name !== CHAIN_SPAN_NAME)
  const chain = chains[chains.length - 1]
  const tool = tools[tools.length - 1]
  return { all, chains, chain, tool, meta: JSON.parse(String(chain.attributes.metadata)) as Record<string, unknown> }
}

const everything = (exporter: InMemorySpanExporter) =>
  JSON.stringify(exporter.getFinishedSpans().map((s) => ({ a: s.attributes, e: s.events, st: s.status })))

test('createTracing: sin configuración no hay trazas; a medias o por http avisa y tampoco', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  assert.equal(createTracing({}), null)
  assert.equal(createTracing({ PHOENIX_COLLECTOR_ENDPOINT: 'https://phoenix.example.com' }), null)
  assert.equal(createTracing({ PHOENIX_COLLECTOR_ENDPOINT: 'http://phoenix.example.com', PHOENIX_API_KEY: 'k' }), null)
  assert.equal(warn.mock.callCount(), 2)

  const live = createTracing({
    PHOENIX_COLLECTOR_ENDPOINT: 'https://phoenix.example.com/',
    PHOENIX_API_KEY: 'k',
    PHOENIX_PROJECT_NAME: 'alegra-mcp-bitacora-prod',
    K_REVISION: 'bitacora-app-00044-abc',
  })
  assert.ok(live)
  assert.equal(live.project, 'alegra-mcp-bitacora-prod')
  assert.equal(live.revision, 'bitacora-app-00044-abc')
  assert.deepEqual(live.policy, { mode: 'metadata', maxContent: 8000 }, 'por defecto, metadata')
  await live.provider.shutdown()

  assert.equal(setup().t.project, 'alegra-mcp-bitacora-test', 'sin nombre, el proyecto de pruebas')
})

test('full: un CHAIN raíz con la pregunta y un TOOL hijo con parámetros y resultado', () => {
  const { t, exporter } = setup()
  emitToolSpans(t, call())
  const { all, chain, tool, meta } = spans(exporter)
  assert.equal(all.length, 2)
  assert.equal(chain.parentSpanContext, undefined, 'el CHAIN es raíz')
  assert.equal(tool.parentSpanContext?.spanId, chain.spanContext().spanId)
  assert.equal(tool.name, 'list_records')

  const qid = questionId(t.hashKey, 'ana@alegra.com', QUESTION)
  assert.equal(chain.attributes['openinference.span.kind'], 'CHAIN')
  assert.equal(chain.attributes['input.value'], QUESTION)
  assert.equal(chain.attributes['input.mime_type'], 'text/plain')
  assert.equal(chain.attributes['session.id'], `ana@alegra.com:cmsessio:q-${qid}`)
  assert.equal(chain.attributes['user.id'], 'ana@alegra.com')
  assert.deepEqual(chain.attributes['tag.tags'], ['Claude', 'OK'])

  assert.equal(tool.attributes['openinference.span.kind'], 'TOOL')
  assert.equal(tool.attributes['tool.name'], 'list_records')
  assert.deepEqual(JSON.parse(String(tool.attributes['input.value'])), { query: 'facturación', limit: 5 })
  assert.equal(tool.attributes['output.mime_type'], 'application/json')
  assert.deepEqual(JSON.parse(String(tool.attributes['output.value'])), RESULT, 'lo que recibió el agente, legible')

  assert.equal(meta.agent, 'Claude')
  assert.equal(meta.rol, 'MANAGER')
  assert.equal(meta.user_agent, 'claude-ai/1.0  inyectado', 'sin saltos de línea')
  assert.equal(meta.capture_mode, 'full')
  assert.equal(meta.pregunta_capturada, true)
  assert.equal(meta.pregunta_id, qid)
  assert.equal(meta.status, 'OK')
  assert.equal(meta.total, 2)
  assert.equal(meta.records_count, 2)
  assert.equal(meta.result_chars, JSON.stringify(RESULT).length)
  assert.equal(meta.duration_ms, 42)
  for (const span of all) assert.equal(span.status.code, SpanStatusCode.OK)
})

test('metadata: ni la pregunta ni los textos extensos; del resultado, solo el resumen', () => {
  const { t, exporter } = setup({ PHOENIX_CAPTURE_MODE: 'metadata' })
  const contenido = 'Cuerpo largo de la novedad '.repeat(50)
  emitToolSpans(
    t,
    call({
      tool: 'create_record',
      args: { tipo: 'Novedad', titulo: 'Factura electrónica', contenido, breveDescripcion: 'Resumen para negocio' },
      result: { id: 'rec00000003', titulo: 'Factura electrónica', email: { ok: false, status: 'skipped' } },
      resultText: '{"id":"rec00000003"}',
    })
  )
  const { chain, tool, meta } = spans(exporter)
  const chainInput = JSON.parse(String(chain.attributes['input.value']))
  assert.deepEqual(chainInput.pregunta, { chars: QUESTION.length })
  assert.equal(chainInput.tool, 'create_record')
  const args = JSON.parse(String(tool.attributes['input.value']))
  assert.deepEqual(args.contenido, { chars: contenido.length })
  assert.deepEqual(args.breveDescripcion, { chars: 'Resumen para negocio'.length })
  assert.equal(args.titulo, 'Factura electrónica', 'los campos cortos sí van')
  const output = JSON.parse(String(tool.attributes['output.value']))
  assert.equal(output.status, 'OK')
  assert.equal(output.email_status, 'skipped')
  assert.equal(meta.record_id, null)
  assert.ok(!everything(exporter).includes(QUESTION))
  assert.ok(!everything(exporter).includes('Cuerpo largo'))
})

test('outbound: guarda la pregunta y lo que se escribe, no lo que responde el MCP', () => {
  const { t, exporter } = setup({ PHOENIX_CAPTURE_MODE: 'outbound' })
  emitToolSpans(t, call({ tool: 'update_record', args: { id: 'rec00000001', contenido: 'Nuevo cuerpo' } }))
  const { chain, tool, meta } = spans(exporter)
  assert.equal(chain.attributes['input.value'], QUESTION)
  assert.equal(JSON.parse(String(tool.attributes['input.value'])).contenido, 'Nuevo cuerpo')
  assert.ok(!String(tool.attributes['output.value']).includes('Factura electrónica en POS'))
  assert.equal(meta.record_id, 'rec00000001')
})

test('una llamada rechazada nunca guarda contenido, ni en full', () => {
  const { t, exporter } = setup()
  const denied = { error: 'Esta acción requiere rol ADMIN.' }
  emitToolSpans(
    t,
    call({ tool: 'delete_record', args: { id: 'rec00000001', contenido: 'no debe salir' }, status: 'denied', detail: 'forbidden_role', result: denied, resultText: JSON.stringify(denied) })
  )
  const { chain, tool, meta } = spans(exporter)
  assert.deepEqual(chain.attributes['tag.tags'], ['Claude', 'DENIED'])
  assert.equal(meta.error_code, 'forbidden_role')
  assert.equal(meta.pregunta_capturada, true, 'se sabe que hubo pregunta, pero no se guarda')
  assert.equal(chain.status.code, SpanStatusCode.UNSET)
  assert.equal(tool.status.code, SpanStatusCode.UNSET)
  assert.ok(!everything(exporter).includes(QUESTION))
  assert.ok(!everything(exporter).includes('no debe salir'))
})

test('registrar_respuesta: la sesión de la pregunta muestra pregunta → respuesta', () => {
  const { t, exporter } = setup()
  const answer = 'Salieron 2 novedades de facturación: factura electrónica en POS y notas crédito masivas.'
  emitToolSpans(t, call())
  emitToolSpans(
    t,
    call({ tool: 'registrar_respuesta', args: { respuesta: answer }, answer, result: undefined, resultText: 'Respuesta registrada.', durationMs: 3 })
  )
  const { chains, chain, tool, meta } = spans(exporter)
  assert.equal(chains.length, 2)
  assert.equal(chains[0].attributes['session.id'], chain.attributes['session.id'], 'misma sesión: la pregunta')
  assert.equal(chain.attributes['input.value'], QUESTION)
  assert.equal(chain.attributes['output.value'], answer)
  assert.equal(chain.attributes['output.mime_type'], 'text/plain')
  assert.equal(meta.respuesta_chars, answer.length)
  assert.equal(JSON.parse(String(chains[0].attributes.metadata)).pregunta_id, meta.pregunta_id)
  assert.equal(JSON.parse(String(tool.attributes['output.value'])).status, 'OK', 'el TOOL solo resume')
})

test('secretos: se enmascaran en parámetros, pregunta, resultado y excepciones', () => {
  const { t, exporter } = setup()
  const apiToken = 'btk_' + 'A1b2C3d4'.repeat(5) + 'xyz'
  emitToolSpans(
    t,
    call({
      question: 'Mi clave: Sup3rS3cret! y el token del Apps Script',
      args: { contenido: `token=abc123456789 ${apiToken}`, titulo: 'Bearer abcdefghijklmnopqrstuvwxyz' },
      result: { conexion: 'postgresql://postgres:pa55word@db.example.com:5432/bitacora' },
      resultText: '{}',
    })
  )
  emitToolSpans(
    t,
    call({ status: 'error', detail: 'exception', result: undefined, resultText: null, error: new Error('falló postgresql://postgres:hunter2@10.0.0.1/db') })
  )
  const all = everything(exporter)
  for (const secret of ['Sup3rS3cret', 'abc123456789', apiToken, 'abcdefghijklmnopqrstuvwxyz', 'pa55word', 'hunter2']) {
    assert.ok(!all.includes(secret), `no debe salir: ${secret}`)
  }
  assert.ok(all.includes(SECRET_MASK))
  assert.equal(maskSecrets('postgresql://u:p4ss@h/db'), `postgresql://${SECRET_MASK}@h/db`)
  assert.equal(maskSecrets(maskSecrets('token=abc123')), `token=${SECRET_MASK}`, 'enmascarar dos veces no cambia nada')
})

test('errores: excepción con evento y estado ERROR; herramienta desconocida con etiqueta fija', () => {
  const { t, exporter } = setup()
  emitToolSpans(t, call({ status: 'error', detail: 'exception', result: undefined, resultText: null, error: new TypeError('boom') }))
  let { chain, tool } = spans(exporter)
  assert.equal(tool.status.code, SpanStatusCode.ERROR)
  assert.equal(chain.status.code, SpanStatusCode.ERROR)
  assert.equal(tool.events[0].name, 'exception')
  assert.equal(tool.events[0].attributes?.['exception.type'], 'TypeError')
  assert.equal(tool.events[0].attributes?.['exception.message'], 'boom')

  emitToolSpans(t, call({ tool: 'Borrar Todo; DROP', status: 'error', detail: 'unknown_tool', result: undefined, resultText: null }))
  ;({ chain, tool } = spans(exporter))
  assert.equal(tool.name, 'unknown_tool')
  assert.equal(chain.attributes['mcp.tool.name'], 'unknown_tool')
})

test('full con error de la herramienta: se ve lo que recibió el agente y el código', () => {
  const { t, exporter } = setup()
  const failed = { preview: true, ok: false, status: 'failed', error: { code: 'NOT_FOUND', message: 'Registro "x" no encontrado.' } }
  emitToolSpans(t, call({ tool: 'notify_pmkt', args: { recordId: 'rec00000009' }, status: 'error', detail: errorCodeOf(failed, 'error'), result: failed, resultText: JSON.stringify(failed) }))
  const { tool, meta } = spans(exporter)
  assert.deepEqual(JSON.parse(String(tool.attributes['output.value'])), failed)
  assert.equal(meta.error_code, 'not_found')
  assert.equal(meta.envio_status, 'failed')
  assert.equal(meta.record_id, 'rec00000009')
})

test('resultSummary, errorCodeOf y traceStatusOf', () => {
  assert.deepEqual(resultSummary(null, null, 'get_record'), { result_chars: 0 })
  assert.deepEqual(resultSummary({ 'clave rara': 1, n: 2, ok: true, s: 'texto', lista: [1, 2, 3] }, 'abc', 'get_record'), {
    result_chars: 3,
    n: 2,
    ok: true,
    lista_count: 3,
  })
  assert.equal(resultSummary({ email: { status: 'sent' } }, '', 'create_record').email_status, 'sent')
  assert.equal(resultSummary({ email: { status: 'sent' } }, '', 'get_record').email_status, undefined)
  assert.equal(resultSummary({ status: 'simulated' }, '', 'notify_pmkt').envio_status, 'simulated')
  assert.equal(resultSummary({ status: 'En progreso' }, '', 'notify_pmkt').envio_status, undefined)

  assert.equal(errorCodeOf({ records: [] }, 'ok'), null)
  assert.equal(errorCodeOf({ error: { code: 'SMTP_AUTH', message: 'x' } }, 'error'), 'smtp_auth')
  assert.equal(errorCodeOf({ error: { code: 'DROP TABLE x' } }, 'error'), 'tool_error')
  assert.equal(errorCodeOf({ error: 'No tienes permiso' }, 'denied'), 'denied')
  assert.equal(errorCodeOf({ error: 'Validación fallida' }, 'error'), 'tool_error')

  assert.deepEqual(['ok', 'denied', 'error'].map((s) => traceStatusOf(s as 'ok')), ['OK', 'DENIED', 'ERROR'])
})

test('recortes: un contenido enorme se recorta y la entrada no pasa del tope', () => {
  const { t, exporter } = setup()
  const big = { records: Array.from({ length: 300 }, (_, i) => ({ id: `rec${i}`, titulo: 'x'.repeat(100) })) }
  emitToolSpans(t, call({ tool: 'create_record', args: { titulo: 'T'.repeat(2000), contenido: 'c'.repeat(50_000) }, result: big, resultText: JSON.stringify(big) }))
  const { tool } = spans(exporter)
  const input = String(tool.attributes['input.value'])
  const output = String(tool.attributes['output.value'])
  assert.ok(input.length <= 8000 + 4000, `entrada de ${input.length}`)
  assert.equal(JSON.parse(input).titulo.length, 500, 'cada campo corto, a 500')
  assert.ok(JSON.parse(input).contenido.endsWith('…[truncado]'))
  assert.ok(output.length <= 8000 && output.endsWith('…[truncado]'))
  assert.equal(tool.attributes['output.mime_type'], 'text/plain', 'recortado ya no es JSON válido')

  const many = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`k${i}`, i]))
  const redacted = redactArguments(many, { mode: 'full', maxContent: 8000 })
  assert.equal(Object.keys(redacted).length, 61)
  assert.equal(redacted._omitidos, 10)
})

test('sesiones: estables por persona y pregunta; sin pregunta, por conector y día', () => {
  const key = Buffer.alloc(32, 7)
  assert.equal(questionId(key, 'ana@alegra.com', '¿Qué salió?'), questionId(key, 'ANA@alegra.com ', '  ¿qué   salió? '))
  assert.notEqual(questionId(key, 'ana@alegra.com', '¿Qué salió?'), questionId(key, 'luis@alegra.com', '¿Qué salió?'))
  assert.notEqual(questionId(key, 'ana@alegra.com', '¿Qué salió?'), questionId(Buffer.alloc(32, 8), 'ana@alegra.com', '¿Qué salió?'))
  const at = new Date('2026-11-24T23:59:00Z')
  assert.equal(sessionIdFor('ana@alegra.com', 'cmsession123', at), 'ana@alegra.com:cmsessio:2026-11-24')
  assert.equal(sessionIdFor('', '', at, 'abc'), 'anonimo:sin-sesi:q-abc')
})

test('variables: modo y tope inválidos caen en valores seguros', (t) => {
  t.mock.method(console, 'warn', () => {})
  assert.equal(parseCaptureMode({ PHOENIX_CAPTURE_MODE: ' FULL ' }), 'full')
  assert.equal(parseCaptureMode({ PHOENIX_CAPTURE_MODE: 'todo' }), 'metadata')
  assert.equal(parseMaxContent({}), 8000)
  assert.equal(parseMaxContent({ PHOENIX_MAX_CONTENT_CHARS: '50' }), 1000)
  assert.equal(parseMaxContent({ PHOENIX_MAX_CONTENT_CHARS: '9999999' }), 100_000)
  assert.equal(parseMaxContent({ PHOENIX_MAX_CONTENT_CHARS: 'mucho' }), 8000)
})
