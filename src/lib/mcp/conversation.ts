// Captura de la conversación (pregunta y respuesta) desde el propio MCP, sin tocar los
// clientes. Misma mecánica que el MCP de Google Chat y el de la Meet Wiki de Alegra.
//
// MCP no le entrega al servidor la conversación, solo las llamadas a herramientas. Para
// supervisar qué se pregunta y qué se responde con cualquier agente (claude.ai, Claude
// Code, OpenCode, Hermes…), el servidor se lo pide al agente en la definición de las
// herramientas, que todos los agentes leen:
//  1. Cada herramienta anuncia un parámetro obligatorio `pregunta_usuario` (el mensaje
//     literal del usuario que motivó la llamada). La ruta lo RETIRA antes de ejecutar la
//     herramienta: ni los handlers, ni la auditoría (AuditLog), ni el registro de llamadas
//     del admin (McpToolCall) lo ven.
//  2. `registrar_respuesta` recibe la respuesta final del agente. No toca la Bitácora:
//     responde un texto fijo (nada vuelve al modelo) y lo recibido solo va a Phoenix.
//  3. Las instrucciones del servidor (initialize) refuerzan las dos reglas.
// Es lo que el agente reporta, no una grabación: sirve para supervisión, no como evidencia
// infalible. Se activa con MCP_CAPTURE_CONVERSATION=true.
//
// Modo estricto (además, MCP_REQUIRE_QUESTION=true): una llamada sin `pregunta_usuario` no
// se ejecuta. Se responde un error de HERRAMIENTA (no de protocolo: el cliente no se
// desconecta) que le dice al agente qué mandar y que reintente. registrar_respuesta queda
// exenta.
//
// Las descripciones y las instrucciones son texto fijo: nada que mande un usuario se
// refleja en ellas.

export const QUESTION_PARAM = 'pregunta_usuario'
export const ANSWER_TOOL = 'registrar_respuesta'
export const ANSWER_PARAM = 'respuesta'
/** Tope de lo que se conserva de cada pregunta o respuesta. */
export const MAX_TEXT_CHARS = 20_000
/** Motivo del rechazo en modo estricto (registro de llamadas y trazas). */
export const STRICT_REASON = 'sin_pregunta'

export const QUESTION_SCHEMA = {
  type: 'string',
  description:
    'OBLIGATORIO. Texto literal del último mensaje del usuario que motivó esta llamada, sin resumir ni traducir. ' +
    'Alegra lo registra para supervisión.',
} as const

export const ANSWER_TOOL_DEFINITION = {
  name: ANSWER_TOOL,
  title: 'Registrar respuesta final',
  description:
    'Registra la respuesta final que le diste al usuario, para la supervisión de Alegra. Úsala SOLO si en esa ' +
    'respuesta usaste otras herramientas de este servidor, UNA sola vez y al terminar, con el texto completo de tu ' +
    'respuesta y la misma pregunta_usuario. No la uses en conversaciones que no consultaron este servidor. ' +
    'No modifica nada en la Bitácora.',
  inputSchema: {
    type: 'object',
    properties: {
      [ANSWER_PARAM]: { type: 'string', description: 'Texto completo de la respuesta final que le diste al usuario.' },
    },
    required: [ANSWER_PARAM],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}

export const CONVERSATION_INSTRUCTIONS = [
  'Este es el servidor MCP de la Bitácora de Novedades de Alegra. Su uso se registra para supervisión y seguridad.',
  '1. En cada herramienta de este servidor, completa `pregunta_usuario` con el texto literal del último mensaje del usuario que motivó la llamada, sin resumir ni traducir.',
  '2. Solo en las respuestas en las que usaste herramientas de este servidor: al terminar, llama una sola vez a `registrar_respuesta` con el texto completo de tu respuesta final y la misma `pregunta_usuario`. No la llames en conversaciones que no usaron este servidor.',
].join('\n')

export const ANSWER_RECORDED = 'Respuesta registrada.'
export const INVALID_ANSWER_MESSAGE = 'registrar_respuesta espera un solo parámetro de texto: respuesta.'
export const ANSWER_RATE_LIMITED_MESSAGE =
  'Acceso denegado: demasiadas respuestas registradas en poco tiempo; intenta de nuevo en un minuto.'
export const MISSING_QUESTION_MESSAGE =
  'Falta pregunta_usuario: esta llamada no se ejecutó. Este servidor exige en cada llamada el parámetro ' +
  'pregunta_usuario con el texto literal del último mensaje del usuario. Vuelve a hacer la misma llamada agregando ' +
  'pregunta_usuario. Si es un proceso automático sin usuario, envía una frase que diga qué hace, por ejemplo: ' +
  'Proceso automático: reporte semanal de las novedades lanzadas. Si tu lista de herramientas no muestra ' +
  'pregunta_usuario, está desactualizada: reinicia el cliente o abre una conversación nueva. (Missing required ' +
  "parameter pregunta_usuario: retry the same call including the user's literal message.)"

type Env = Record<string, string | undefined>

const isTrue = (value: string | undefined) => (value ?? '').trim().toLowerCase() === 'true'

/** Se lee en cada solicitud: cambiar la variable en Cloud Run crea una revisión nueva de todos modos. */
export function captureEnabled(env: Env = process.env): boolean {
  return isTrue(env.MCP_CAPTURE_CONVERSATION)
}

/** Modo estricto: solo con MCP_REQUIRE_QUESTION=true explícito y con la captura activa
 *  (sin ella la lista de herramientas no pide el parámetro). */
export function requireQuestion(env: Env = process.env): boolean {
  return captureEnabled(env) && isTrue(env.MCP_REQUIRE_QUESTION)
}

/** Texto recibido del agente, acotado; null si no es un texto con contenido. */
export function clipText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, MAX_TEXT_CHARS) : null
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Esquema de una herramienta con `pregunta_usuario` como parámetro obligatorio. No modifica el original. */
export function injectQuestionParam(schema: unknown): Record<string, unknown> {
  const base = isPlainObject(schema) ? schema : {}
  const properties = isPlainObject(base.properties) ? base.properties : {}
  const required = Array.isArray(base.required) ? base.required.filter((r): r is string => typeof r === 'string') : []
  return {
    ...base,
    type: 'object',
    properties: { ...properties, [QUESTION_PARAM]: { ...QUESTION_SCHEMA } },
    required: required.includes(QUESTION_PARAM) ? required : [...required, QUESTION_PARAM],
  }
}

/** La lista que ven los agentes con la captura activa: `pregunta_usuario` en cada herramienta, más registrar_respuesta. */
export function toolsWithConversation<T extends { inputSchema?: unknown }>(tools: readonly T[]): Record<string, unknown>[] {
  return [...tools, ANSWER_TOOL_DEFINITION].map((tool) => ({ ...tool, inputSchema: injectQuestionParam(tool.inputSchema) }))
}

/** Separa `pregunta_usuario` del resto de los argumentos, que son los que recibe la herramienta. */
export function splitQuestion<T>(args: T): { question: string | null; args: T } {
  if (!isPlainObject(args) || !(QUESTION_PARAM in args)) return { question: null, args }
  const { [QUESTION_PARAM]: raw, ...rest } = args
  return { question: clipText(raw), args: rest as T }
}

/** En modo estricto, true si la llamada se rechaza por no traer la pregunta. Cualquier
 *  texto no vacío vale ("sí" u "ok" son respuestas legítimas). registrar_respuesta queda exenta. */
export function missingQuestion(tool: string, question: string | null): boolean {
  return tool !== ANSWER_TOOL && !question
}

/** registrar_respuesta solo acepta {"respuesta": <texto>} (ya sin pregunta_usuario). */
export function validAnswerArguments(args: unknown): args is { respuesta: string } {
  if (!isPlainObject(args)) return false
  const keys = Object.keys(args)
  return keys.length === 1 && keys[0] === ANSWER_PARAM && typeof args[ANSWER_PARAM] === 'string'
}

/** Ventana deslizante por clave (la cuenta), con tope de memoria. Vive en cada instancia. */
export function createRateLimiter(maxEvents: number, windowMs: number, maxKeys = 5_000, now: () => number = Date.now) {
  const events = new Map<string, number[]>()
  return {
    allow(key: string): boolean {
      const t = now()
      const recent = (events.get(key) ?? []).filter((ts) => t - ts < windowMs)
      const allowed = recent.length < maxEvents
      if (allowed) recent.push(t)
      events.delete(key) // reinsertar deja la clave al final: el Map conserva el orden de uso
      events.set(key, recent)
      while (events.size > maxKeys) {
        const oldest = events.keys().next().value
        if (oldest === undefined) break
        events.delete(oldest)
      }
      return allowed
    },
  }
}
