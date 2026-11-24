import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANSWER_TOOL,
  CONVERSATION_INSTRUCTIONS,
  MAX_TEXT_CHARS,
  MISSING_QUESTION_MESSAGE,
  QUESTION_PARAM,
  captureEnabled,
  clipText,
  createRateLimiter,
  injectQuestionParam,
  missingQuestion,
  requireQuestion,
  splitQuestion,
  toolsWithConversation,
  validAnswerArguments,
} from '@/lib/mcp/conversation'
import { TOOLS } from '@/lib/mcp/tools'

type Schema = { properties: Record<string, unknown>; required: string[] }

test('captureEnabled y requireQuestion: solo con «true» explícito; el modo estricto exige la captura', () => {
  assert.equal(captureEnabled({}), false)
  assert.equal(captureEnabled({ MCP_CAPTURE_CONVERSATION: 'TRUE ' }), true)
  assert.equal(captureEnabled({ MCP_CAPTURE_CONVERSATION: '1' }), false)
  assert.equal(requireQuestion({ MCP_REQUIRE_QUESTION: 'true' }), false, 'sin captura no hay modo estricto')
  assert.equal(requireQuestion({ MCP_CAPTURE_CONVERSATION: 'true', MCP_REQUIRE_QUESTION: 'true' }), true)
  assert.equal(requireQuestion({ MCP_CAPTURE_CONVERSATION: 'true', MCP_REQUIRE_QUESTION: 'false' }), false)
})

test('injectQuestionParam: agrega pregunta_usuario obligatoria sin tocar el esquema original', () => {
  const original = { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }
  const copy = JSON.parse(JSON.stringify(original))
  const out = injectQuestionParam(original) as unknown as Schema
  assert.deepEqual(out.required, ['id', QUESTION_PARAM])
  assert.ok(out.properties[QUESTION_PARAM])
  assert.ok(out.properties.id)
  assert.deepEqual(original, copy, 'el original no cambia')
  assert.deepEqual((injectQuestionParam(out) as unknown as Schema).required, ['id', QUESTION_PARAM], 'no se duplica')
  assert.deepEqual((injectQuestionParam(undefined) as unknown as Schema).required, [QUESTION_PARAM])
})

test('toolsWithConversation: cada herramienta de la Bitácora pide pregunta_usuario y se suma registrar_respuesta', () => {
  const before = JSON.stringify(TOOLS)
  const tools = toolsWithConversation(TOOLS) as Array<{ name: string; inputSchema: Schema; annotations?: { readOnlyHint?: boolean } }>
  assert.deepEqual(tools.map((t) => t.name), [...TOOLS.map((t) => t.name), ANSWER_TOOL])
  for (const tool of tools) assert.ok(tool.inputSchema.required.includes(QUESTION_PARAM), tool.name)
  const create = tools.find((t) => t.name === 'create_record')!
  for (const field of ['tipo', 'titulo', 'fechaLanzamiento', 'elaborado']) assert.ok(create.inputSchema.required.includes(field), field)
  const answer = tools.find((t) => t.name === ANSWER_TOOL)!
  assert.deepEqual(Object.keys(answer.inputSchema.properties).sort(), ['pregunta_usuario', 'respuesta'])
  assert.equal(answer.annotations?.readOnlyHint, true)
  assert.equal(JSON.stringify(TOOLS), before, 'la lista original no cambia')
})

test('splitQuestion: retira pregunta_usuario y la acota; sin ella no toca los argumentos', () => {
  const args = { id: 'abc', [QUESTION_PARAM]: '  ¿Qué salió ayer?  ' }
  assert.deepEqual(splitQuestion(args), { question: '¿Qué salió ayer?', args: { id: 'abc' } })
  assert.deepEqual(splitQuestion({ id: 'abc' }), { question: null, args: { id: 'abc' } })
  assert.deepEqual(splitQuestion({ [QUESTION_PARAM]: '   ' }), { question: null, args: {} }, 'vacía: se retira igual')
  assert.deepEqual(splitQuestion({ [QUESTION_PARAM]: 42 }), { question: null, args: {} }, 'no texto: se retira igual')
  assert.equal(splitQuestion({ [QUESTION_PARAM]: 'x'.repeat(MAX_TEXT_CHARS + 50) }).question?.length, MAX_TEXT_CHARS)
  assert.deepEqual(splitQuestion('texto'), { question: null, args: 'texto' })
  assert.equal(clipText(null), null)
})

test('missingQuestion: cualquier texto vale («sí» es una respuesta legítima); registrar_respuesta queda exenta', () => {
  assert.equal(missingQuestion('list_records', null), true)
  assert.equal(missingQuestion('list_records', 'sí'), false)
  assert.equal(missingQuestion(ANSWER_TOOL, null), false)
})

test('validAnswerArguments: solo { respuesta: texto }', () => {
  assert.equal(validAnswerArguments({ respuesta: 'Listo.' }), true)
  assert.equal(validAnswerArguments({ respuesta: 'Listo.', extra: 1 }), false)
  assert.equal(validAnswerArguments({ respuesta: 3 }), false)
  assert.equal(validAnswerArguments({}), false)
  assert.equal(validAnswerArguments(['respuesta']), false)
  assert.equal(validAnswerArguments(null), false)
})

test('createRateLimiter: ventana deslizante por cuenta y tope de claves en memoria', () => {
  let now = 0
  const limiter = createRateLimiter(2, 1000, 2, () => now)
  assert.equal(limiter.allow('a'), true)
  assert.equal(limiter.allow('a'), true)
  assert.equal(limiter.allow('a'), false, 'tercera en la ventana')
  assert.equal(limiter.allow('b'), true, 'cada cuenta tiene su cupo')
  now = 1001
  assert.equal(limiter.allow('a'), true, 'la ventana se libera')

  // Tope de 2 cuentas: se olvida la usada hace más tiempo.
  const lru = createRateLimiter(1, 60_000, 2, () => now)
  lru.allow('x')
  lru.allow('y')
  assert.equal(lru.allow('x'), false, 'x sigue limitada (y queda como la más antigua)')
  lru.allow('z')
  assert.equal(lru.allow('y'), true, 'y se olvidó por el tope de cuentas')
  assert.equal(lru.allow('z'), false, 'z sigue limitada')
})

test('textos fijos: hablan de la Bitácora y explican cómo reintentar', () => {
  assert.match(CONVERSATION_INSTRUCTIONS, /Bitácora de Novedades/)
  assert.doesNotMatch(CONVERSATION_INSTRUCTIONS, /Meet Wiki|Google Chat/)
  assert.match(MISSING_QUESTION_MESSAGE, /pregunta_usuario/)
  const answer = toolsWithConversation([]).find((t) => t.name === ANSWER_TOOL) as { description: string }
  assert.match(answer.description, /No modifica nada en la Bitácora/)
})
