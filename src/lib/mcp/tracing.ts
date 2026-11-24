import { createHash, createHmac, randomBytes } from 'crypto'
import { ROOT_CONTEXT, SpanStatusCode, trace, type Tracer } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base'
import { agentOf } from '@/lib/admin/agents'
import { ANSWER_PARAM, ANSWER_TOOL, QUESTION_PARAM } from './conversation'
import type { CallStatus } from './call-log'

/**
 * Trazas del MCP hacia Phoenix (OpenTelemetry + convenciones OpenInference), A LA PAR con el
 * registro de llamadas del admin (call-log.ts → Admin → Conexiones MCP) y la auditoría
 * (AuditLog), que no cambian. Misma forma que los MCP de Google Chat y de la Meet Wiki, para
 * que se lean igual:
 *
 *     mcp_orchestrator.bitacora   CHAIN (raíz)  quién, agente, pregunta → respuesta, resultado
 *      └─ <herramienta>           TOOL          parámetros y resultado
 *
 * Con la captura de la conversación (conversation.ts), la entrada del CHAIN es la pregunta
 * del usuario y, en registrar_respuesta, su salida es la respuesta del agente. La sesión en
 * Phoenix es esa pregunta (todas sus llamadas y la respuesta); sin pregunta, la persona con
 * ese conector en ese día. Phoenix solo agrupa en "Sessions" las trazas cuya raíz es un
 * CHAIN con session.id.
 *
 * Cuánto contenido sale lo decide PHOENIX_CAPTURE_MODE:
 *   metadata  (por defecto) sin textos largos: de la pregunta, la respuesta y los campos
 *             extensos (contenido, breve descripción, comentario, motivo), solo su tamaño;
 *             del resultado, un resumen numérico.
 *   outbound  + la pregunta, la respuesta del agente y lo que escribe (crear o editar una
 *             novedad, el motivo de un reenvío).
 *   full      + lo que el MCP le RESPONDE al agente (novedades, auditoría, envíos… y los
 *             errores de validación), recortado a PHOENIX_MAX_CONTENT_CHARS (8000 por defecto).
 *
 * En todos los modos se enmascaran secretos reconocibles (también los tokens btk_ de la API
 * y las credenciales dentro de una URL) y a una llamada RECHAZADA (rol, límite, sin
 * pregunta) nunca se le guarda contenido. El identificador de la pregunta es un HMAC con
 * clave del servidor: no se puede confirmar por adivinanza desde Phoenix.
 *
 * Falla abierto: sin PHOENIX_COLLECTOR_ENDPOINT (https) o sin PHOENIX_API_KEY, o si algo
 * falla al iniciar, el MCP funciona igual y sin trazas. Ningún error de este módulo llega a
 * una herramienta, y ninguna herramienta espera a Phoenix.
 */

export const DATA_SOURCE = 'alegra-mcp-bitacora'
export const CHAIN_SPAN_NAME = 'mcp_orchestrator.bitacora'
export const CAPTURE_MODES = ['metadata', 'outbound', 'full'] as const
export type CaptureMode = (typeof CAPTURE_MODES)[number]
/** Estados en Phoenix: los mismos que en los otros MCP de Alegra. */
export type TraceStatus = 'OK' | 'ERROR' | 'DENIED'
/** Mismo tope que los otros MCP: un atributo enorme lo rechaza el colector. */
export const MAX_ATTRIBUTE_LENGTH = 8000
/** Cada parámetro que no es contenido (ids, filtros, fechas, títulos…), por separado. */
const MAX_PARAM_LENGTH = 500
/** Una llamada con más parámetros que estos solo deja constancia de cuántos se omitieron. */
const MAX_PARAMS = 60
export const SECRET_MASK = '[secreto oculto]'
const TRUNCATED = '…[truncado]'

/** Campos de texto extenso: en metadata solo su tamaño; en los demás modos, el texto. */
const CONTENT_PARAMS: ReadonlySet<string> = new Set(['contenido', 'breveDescripcion', 'comentarioEvento', 'reason', ANSWER_PARAM])

// Convenciones OpenInference (github.com/Arize-ai/openinference). Son cadenas estables; se
// escriben aquí para no sumar otra dependencia.
const SPAN_KIND = 'openinference.span.kind'
const SESSION_ID = 'session.id'
const USER_ID = 'user.id'
const INPUT_VALUE = 'input.value'
const INPUT_MIME = 'input.mime_type'
const OUTPUT_VALUE = 'output.value'
const OUTPUT_MIME = 'output.mime_type'
const TOOL_NAME = 'tool.name'
const METADATA = 'metadata'
const TAGS = 'tag.tags'
const JSON_MIME = 'application/json'
const TEXT_MIME = 'text/plain'

const TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/
const RECORD_ID_RE = /^[A-Za-z0-9_-]{8,40}$/
const SAFE_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/
const SAFE_CODE_RE = /^[a-z][a-z0-9_]{0,30}$/
const ROLE_RE = /^[A-Z]{1,20}$/

// Secretos que se enmascaran en cualquier texto antes de salir hacia Phoenix.
const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, SECRET_MASK],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*$/g, SECRET_MASK], // llave cortada (sin END): todo lo que sigue
  [/\b([a-z][a-z0-9+.-]{1,20}:\/\/)[^\s:@/"'[]+:[^\s@/"']+@/gi, `$1${SECRET_MASK}@`], // usuario:clave@ en una URL (p. ej. postgresql://)
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, SECRET_MASK], // JWT
  [/\bbtk_[A-Za-z0-9_-]{20,}/g, SECRET_MASK], // token de la API REST de la Bitácora
  [/\bAIza[0-9A-Za-z_-]{30,}/g, SECRET_MASK], // Google API key
  [/\bGOCSPX-[0-9A-Za-z_-]{20,}/g, SECRET_MASK], // secreto de cliente OAuth de Google
  [/\bya29\.[0-9A-Za-z_-]{20,}/g, SECRET_MASK], // token de acceso de Google
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, SECRET_MASK], // AWS
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{30,}/g, SECRET_MASK], // GitHub
  [/\bgithub_pat_[0-9A-Za-z_]{30,}/g, SECRET_MASK],
  [/\bxox[abprs]-[0-9A-Za-z-]{10,}/g, SECRET_MASK], // Slack
  [/\bsk-(?:ant-|proj-)?[0-9A-Za-z_-]{20,}/g, SECRET_MASK], // OpenAI / Anthropic / LiteLLM
  [/\bsbp_[0-9A-Za-z]{30,}/g, SECRET_MASK], // Supabase (token personal)
  [/\bsb_secret_[0-9A-Za-z_-]{20,}/g, SECRET_MASK], // Supabase (llave secreta)
  [/\b(bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, `$1 ${SECRET_MASK}`],
  [
    // El valor no empieza con "[": así no se vuelve a enmascarar lo que ya quedó oculto.
    /\b(password|passwd|pwd|contraseña|contrasena|clave|secret|api[_-]?key|token|signature|sig)("?\s*[:=]\s*"?)([^\s"&[][^\s"&]*)/gi,
    `$1$2${SECRET_MASK}`,
  ],
]

// ── Funciones puras (sin OpenTelemetry) ──────────────────────────────────────

export function truncate(text: string, limit: number = MAX_ATTRIBUTE_LENGTH): string {
  if (text.length <= limit) return text
  return text.slice(0, Math.max(0, limit - TRUNCATED.length)) + TRUNCATED
}

/** Enmascara llaves, tokens, contraseñas y firmas reconocibles dentro de un texto. */
export function maskSecrets(text: string): string {
  let out = text
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement)
  return out
}

const toJson = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : toJson(value))

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Margen que se enmascara más allá del tope: cubre un secreto largo que empiece justo antes del corte. */
const MASK_MARGIN = 8000

/** Sin secretos y acotado. Solo se procesa una ventana algo mayor que el tope: con textos de
 *  cientos de KB, pasar las expresiones por todo costaría CPU en cada llamada. */
function clean(value: unknown, limit: number): string {
  const text = asText(value)
  const head = text.length > limit + MASK_MARGIN ? text.slice(0, limit + MASK_MARGIN) : text
  return truncate(maskSecrets(head), limit)
}

/** Un texto de una línea (sin caracteres de control), limpio y corto; null si no hay. */
function oneLine(value: string | null | undefined, limit: number): string | null {
  const text = (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return text ? clean(text, limit) : null
}

/** JSON (Phoenix lo muestra como árbol) si el texto lo es; si quedó recortado, texto plano. */
function jsonOrText(text: string): { value: string; mime: string } {
  try {
    JSON.parse(text)
    return { value: text, mime: JSON_MIME }
  } catch {
    return { value: text, mime: TEXT_MIME }
  }
}

type Env = Record<string, string | undefined>

export function parseCaptureMode(env: Env): CaptureMode {
  const raw = (env.PHOENIX_CAPTURE_MODE ?? '').trim().toLowerCase()
  if ((CAPTURE_MODES as readonly string[]).includes(raw)) return raw as CaptureMode
  if (raw) console.warn(`[tracing] PHOENIX_CAPTURE_MODE=${JSON.stringify(raw.slice(0, 20))} no es válido; se usa "metadata"`)
  return 'metadata'
}

export function parseMaxContent(env: Env): number {
  const raw = (env.PHOENIX_MAX_CONTENT_CHARS ?? '').trim()
  if (!raw) return MAX_ATTRIBUTE_LENGTH
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    console.warn(`[tracing] PHOENIX_MAX_CONTENT_CHARS no es un número; se usa ${MAX_ATTRIBUTE_LENGTH}`)
    return MAX_ATTRIBUTE_LENGTH
  }
  return Math.min(Math.max(Math.trunc(n), 1000), 100_000)
}

export interface ContentPolicy {
  mode: CaptureMode
  maxContent: number
}

/** Los parámetros de una llamada, aptos para Phoenix según el modo. */
export function redactArguments(args: unknown, policy: ContentPolicy): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!isPlainObject(args)) return out
  const withContent = policy.mode !== 'metadata'
  const entries = Object.entries(args).filter(([key, value]) => value !== undefined && key !== QUESTION_PARAM)
  for (const [key, value] of entries.slice(0, MAX_PARAMS)) {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      out[key] = value
    } else if (CONTENT_PARAMS.has(key)) {
      out[key] = withContent ? clean(value, policy.maxContent) : { chars: asText(value).length }
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 20).map((v) => (v !== null && (typeof v === 'string' || typeof v === 'object') ? clean(v, MAX_PARAM_LENGTH) : v))
    } else {
      out[key] = clean(value, MAX_PARAM_LENGTH)
    }
  }
  if (entries.length > MAX_PARAMS) out._omitidos = entries.length - MAX_PARAMS
  return out
}

/** Resumen numérico del resultado, sin contenido (en todos los modos): el tamaño de lo que
 *  recibió el agente, los números y booleanos de primer nivel, cuántos elementos trae cada
 *  lista y el estado del correo (create/update) o del envío (notify_pmkt). */
export function resultSummary(result: unknown, resultText: string | null | undefined, tool: string): Record<string, unknown> {
  const summary: Record<string, unknown> = { result_chars: (resultText ?? '').length }
  if (!isPlainObject(result)) return summary
  let fields = 0
  for (const [key, value] of Object.entries(result)) {
    if (fields >= 20 || !SAFE_KEY_RE.test(key)) continue
    if (Array.isArray(value)) summary[`${key}_count`] = value.length
    else if (typeof value === 'number' || typeof value === 'boolean') summary[key] = value
    else continue
    fields++
  }
  const emailStatus = isPlainObject(result.email) ? result.email.status : undefined
  if ((tool === 'create_record' || tool === 'update_record') && typeof emailStatus === 'string' && SAFE_CODE_RE.test(emailStatus)) {
    summary.email_status = emailStatus
  }
  if (tool === 'notify_pmkt' && typeof result.status === 'string' && SAFE_CODE_RE.test(result.status)) summary.envio_status = result.status
  return summary
}

export const traceStatusOf = (status: CallStatus): TraceStatus =>
  status === 'ok' ? 'OK' : status === 'denied' ? 'DENIED' : 'ERROR'

/** Código de error para Phoenix, de lista cerrada: el código del envío de correo cuando lo
 *  trae (validation, duplicate, smtp_auth…); si no, «denied» o «tool_error». */
export function errorCodeOf(result: unknown, status: CallStatus): string | null {
  if (status === 'ok') return null
  const error = isPlainObject(result) ? result.error : undefined
  if (isPlainObject(error) && typeof error.code === 'string') {
    const code = error.code.trim().toLowerCase()
    if (SAFE_CODE_RE.test(code)) return code
  }
  return status === 'denied' ? 'denied' : 'tool_error'
}

/** Lo que el MCP le devolvió al agente, apto para Phoenix (modo full): JSON legible, sin
 *  secretos y acotado. */
export function readableResult(result: unknown, resultText: string | null | undefined, maxContent: number): { value: string; mime: string } {
  let text = resultText ?? ''
  if (result !== undefined) {
    try {
      text = JSON.stringify(result, null, 2) ?? text
    } catch {
      // se queda con el texto que recibió el agente
    }
  }
  return jsonOrText(clean(text, maxContent))
}

/**
 * El transporte no guarda sesión. Con pregunta, la "sesión" en Phoenix es esa pregunta
 * (todas sus llamadas y la respuesta registrada); sin pregunta, esta persona con este
 * conector (sesión OAuth) en este día (UTC). Mismo formato que los otros MCP de Alegra.
 */
export function sessionIdFor(email: string, oauthSessionId: string, at: Date, questionKey?: string | null): string {
  const prefix = `${email || 'anonimo'}:${(oauthSessionId || 'sin-sesion').slice(0, 8)}`
  return questionKey ? `${prefix}:q-${questionKey}` : `${prefix}:${at.toISOString().slice(0, 10)}`
}

/** Clave de los seudónimos: MCP_TRACE_HASH_KEY si existe; si no, derivada (SHA-256 con
 *  separador de dominio, sin exponerla) de la llave de Phoenix, que ya es secreta y estable. */
export function hashKeyFromEnv(env: Env): Buffer {
  const material = (env.MCP_TRACE_HASH_KEY ?? '').trim() || (env.PHOENIX_API_KEY ?? '').trim()
  if (!material) return randomBytes(32)
  return createHash('sha256').update(`alegra-mcp-trace-pseudonym-v1|${material}`).digest()
}

/** Identificador estable de una pregunta de una persona: las llamadas que el agente hace para
 *  responderla (y su registrar_respuesta) comparten este valor. */
export function questionId(key: Buffer, email: string, question: string): string {
  const normalized = question.trim().split(/\s+/).join(' ').toLowerCase()
  return createHmac('sha256', key).update(`pregunta|${email.trim().toLowerCase()}|${normalized}`).digest('hex').slice(0, 12)
}

function recordIdOf(args: unknown): string | null {
  if (!isPlainObject(args)) return null
  const value = typeof args.id === 'string' ? args.id : args.recordId
  return typeof value === 'string' && RECORD_ID_RE.test(value) ? value : null
}

function describeError(error: unknown, detail: string | null): { type: string; message: string } {
  if (error instanceof Error) return { type: error.name || 'Error', message: clean(error.message, 500) }
  if (typeof error === 'string') return { type: 'ToolError', message: clean(error, 500) }
  return { type: 'ToolError', message: detail ?? 'exception' }
}

// ── OpenTelemetry ────────────────────────────────────────────────────────────

/** Lo que la ruta del MCP sabe de una llamada cuando termina. */
export interface ToolCallTrace {
  userEmail: string
  /** Id de la sesión OAuth (el "conector" de esa persona); vacío si no hay. */
  sessionId: string
  /** Nombre con el que el cliente se registró por OAuth: informativo, se puede falsear. */
  clientName: string | null
  /** Rol de la persona en la Bitácora (ADMIN, MANAGER, VIEWER). */
  role: string
  userAgent?: string | null
  tool: string
  /** Argumentos SIN pregunta_usuario (lo mismo que recibió la herramienta). */
  args: unknown
  /** pregunta_usuario, ya acotada (conversation.ts). */
  question?: string | null
  /** La respuesta final que registró el agente (solo registrar_respuesta). */
  answer?: string | null
  /** El mismo estado que el registro de llamadas del admin (call-log.ts). */
  status: CallStatus
  /** Código de lista cerrada (sin_pregunta, forbidden_role, unknown_tool, exception…) o null. */
  detail: string | null
  startedAt: number
  durationMs: number
  /** Lo que devolvió la herramienta. */
  result?: unknown
  /** El texto que recibió el agente. */
  resultText?: string | null
  /** La excepción (solo con estado error). */
  error?: unknown
}

export type ToolTracer = (call: ToolCallTrace) => void

export interface Tracing {
  tracer: Tracer
  provider: BasicTracerProvider
  project: string
  policy: ContentPolicy
  revision: string
  hashKey: Buffer
}

/** Solo https (o http a localhost para pruebas locales): la llave va en la cabecera. */
function isSafeEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

const EXPORT_SUCCESS = 0 // ExportResultCode.SUCCESS de @opentelemetry/core
const WARN_EVERY_MS = 5 * 60_000

/** Deja en el log (como mucho cada 5 min) cuando Phoenix rechaza o no recibe las trazas, p. ej.
 *  un 401 por una llave equivocada. Sin esto el SDK falla en silencio. */
class WarningExporter implements SpanExporter {
  private lastWarn = 0
  constructor(private readonly inner: SpanExporter) {}
  export(spans: ReadableSpan[], done: Parameters<SpanExporter['export']>[1]): void {
    this.inner.export(spans, (result) => {
      if (result.code !== EXPORT_SUCCESS && Date.now() - this.lastWarn > WARN_EVERY_MS) {
        this.lastWarn = Date.now()
        console.warn('[tracing] Phoenix no recibió trazas:', result.error?.message ?? 'error desconocido')
      }
      done(result)
    })
  }
  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }
  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve()
  }
}

/**
 * Conecta con Phoenix. Devuelve null (sin trazas) si falta configuración o algo falla.
 * `exporter` existe para las pruebas (exportador en memoria, sin red). El proveedor es
 * PRIVADO (no se registra como global): Next.js, Prisma y el SDK de IA no mandan sus spans.
 */
export function createTracing(env: Env = process.env, exporter?: SpanExporter): Tracing | null {
  const endpoint = (env.PHOENIX_COLLECTOR_ENDPOINT ?? '').trim().replace(/\/+$/, '')
  const apiKey = (env.PHOENIX_API_KEY ?? '').trim()
  if (!exporter) {
    if (!endpoint && !apiKey) return null // sin configurar (local, pruebas): en silencio
    if (!endpoint || !apiKey) {
      console.warn('[tracing] Phoenix desactivado: falta PHOENIX_COLLECTOR_ENDPOINT o PHOENIX_API_KEY')
      return null
    }
    if (!isSafeEndpoint(endpoint)) {
      console.warn('[tracing] Phoenix desactivado: PHOENIX_COLLECTOR_ENDPOINT debe ser https')
      return null
    }
  }
  try {
    const project = (env.PHOENIX_PROJECT_NAME ?? '').trim() || `${DATA_SOURCE}-test`
    const revision = (env.K_REVISION ?? '').trim() || 'local'
    const processor = exporter
      ? new SimpleSpanProcessor(exporter)
      : new BatchSpanProcessor(
          new WarningExporter(
            new OTLPTraceExporter({
              url: `${endpoint}/v1/traces`,
              headers: { authorization: `Bearer ${apiKey}`, 'x-data-source': DATA_SOURCE },
              timeoutMillis: 10_000,
            })
          ),
          { maxQueueSize: 2048, maxExportBatchSize: 256, scheduledDelayMillis: 5_000, exportTimeoutMillis: 10_000 }
        )
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        'openinference.project.name': project, // Phoenix crea el proyecto con este nombre
        'service.name': 'bitacora-mcp',
        'service.version': revision,
      }),
      spanProcessors: [processor],
    })
    return {
      tracer: provider.getTracer('bitacora-mcp'),
      provider,
      project,
      policy: { mode: parseCaptureMode(env), maxContent: parseMaxContent(env) },
      revision,
      hashKey: hashKeyFromEnv(env),
    }
  } catch (e) {
    console.error('[tracing] Phoenix no se pudo iniciar; el MCP sigue sin trazas:', e instanceof Error ? e.message : e)
    return null
  }
}

/** Crea los dos spans de una llamada ya terminada (con sus tiempos reales). */
export function emitToolSpans(t: Tracing, call: ToolCallTrace): void {
  const { policy } = t
  const status = traceStatusOf(call.status)
  // A quien se le niega el servicio no se le guarda contenido, en ningún modo: ni la
  // pregunta, ni los parámetros, ni el resultado.
  const contentPolicy: ContentPolicy = status === 'DENIED' ? { ...policy, mode: 'metadata' } : policy
  const withContent = contentPolicy.mode !== 'metadata'
  const tool = call.detail === 'unknown_tool' || !TOOL_NAME_RE.test(call.tool) ? 'unknown_tool' : call.tool
  const agent = agentOf(call.clientName)
  const start = call.startedAt
  const end = call.startedAt + Math.max(0, call.durationMs)
  const email = call.userEmail.toLowerCase()
  const question = call.question?.trim() || null
  const answer = call.answer?.trim() || null
  const qid = question ? questionId(t.hashKey, email, question) : null
  const session = sessionIdFor(email, call.sessionId, new Date(start), qid)
  const summary = resultSummary(call.result, call.resultText, tool)

  const params = redactArguments(call.args, contentPolicy)
  // El contenido ya viene recortado; el margen es para el resto de los parámetros.
  const inputLimit = policy.maxContent + 4000
  const outcome: Record<string, unknown> = { status, ...summary }
  if (call.detail) outcome.error_code = call.detail

  // En full, la salida es lo que recibió el agente, también cuando la herramienta respondió
  // con un error (p. ej. los campos que faltan para comunicar); nunca en una rechazada.
  let output = { value: truncate(toJson(outcome)), mime: JSON_MIME }
  if (status !== 'DENIED' && policy.mode === 'full' && tool !== ANSWER_TOOL && (call.result !== undefined || call.resultText)) {
    output = readableResult(call.result, call.resultText, policy.maxContent)
  }
  const toolInput = jsonOrText(truncate(toJson(params), inputLimit))

  // Entrada del CHAIN: la pregunta del usuario (si el agente la mandó y el modo guarda
  // contenido); si no, la herramienta y sus parámetros.
  let chainInput: { value: string; mime: string }
  if (question && withContent) {
    chainInput = { value: clean(question, policy.maxContent), mime: TEXT_MIME }
  } else {
    const payload: Record<string, unknown> = { tool, arguments: params }
    if (question) payload.pregunta = { chars: question.length }
    chainInput = jsonOrText(truncate(toJson(payload), inputLimit))
  }
  // Salida del CHAIN: la respuesta final del agente cuando la registró; así la sesión de una
  // pregunta muestra pregunta → respuesta.
  const chainOutput =
    answer && withContent && status === 'OK' ? { value: clean(answer, policy.maxContent), mime: TEXT_MIME } : output

  const metadata: Record<string, unknown> = {
    agent,
    client_name: oneLine(call.clientName, 100),
    user_agent: oneLine(call.userAgent, 200),
    rol: ROLE_RE.test(call.role) ? call.role : null,
    oauth_session_id: call.sessionId || null,
    record_id: recordIdOf(call.args),
    revision: t.revision,
    capture_mode: policy.mode,
    pregunta_capturada: question !== null,
    pregunta_id: qid,
    status,
    error_code: call.detail,
    duration_ms: Math.round(Math.max(0, call.durationMs)),
    ...summary,
  }
  if (answer) metadata.respuesta_chars = answer.length

  const chain = t.tracer.startSpan(
    CHAIN_SPAN_NAME,
    {
      startTime: start,
      attributes: {
        [SPAN_KIND]: 'CHAIN',
        [SESSION_ID]: session,
        [USER_ID]: email,
        [INPUT_VALUE]: chainInput.value,
        [INPUT_MIME]: chainInput.mime,
        [OUTPUT_VALUE]: chainOutput.value,
        [OUTPUT_MIME]: chainOutput.mime,
        [METADATA]: truncate(toJson(metadata)),
        [TAGS]: [agent, status],
        'mcp.tool.name': tool,
      },
    },
    ROOT_CONTEXT // siempre raíz: Phoenix exige un CHAIN arriba para Sessions
  )
  const toolSpan = t.tracer.startSpan(
    tool,
    {
      startTime: start,
      attributes: {
        [SPAN_KIND]: 'TOOL',
        [TOOL_NAME]: tool,
        [SESSION_ID]: session,
        [USER_ID]: email,
        [INPUT_VALUE]: toolInput.value,
        [INPUT_MIME]: toolInput.mime,
        [OUTPUT_VALUE]: output.value,
        [OUTPUT_MIME]: output.mime,
      },
    },
    trace.setSpan(ROOT_CONTEXT, chain)
  )

  if (status === 'ERROR') {
    const err = describeError(call.error, call.detail)
    toolSpan.addEvent('exception', { 'exception.type': err.type, 'exception.message': err.message }, end)
    for (const span of [toolSpan, chain]) span.setStatus({ code: SpanStatusCode.ERROR, message: call.detail ?? 'exception' })
  } else if (status === 'OK') {
    for (const span of [toolSpan, chain]) span.setStatus({ code: SpanStatusCode.OK })
  }
  toolSpan.end(end)
  chain.end(end)
}

let current: Tracing | null | undefined

function getTracing(): Tracing | null {
  if (current === undefined) {
    current = createTracing()
    if (current) console.info(`[tracing] Phoenix activo: proyecto ${current.project}, modo ${current.policy.mode}`)
  }
  return current
}

/** Solo para pruebas: usa esta conexión (p. ej. con un exportador en memoria); con undefined
 *  vuelve a leer el entorno en la siguiente llamada. */
export function setTracingForTests(t: Tracing | null | undefined): void {
  current = t
}

/**
 * Registra la llamada en Phoenix. No lanza ni espera: el envío sale en segundo plano. El
 * forceFlush (sin await) arranca el envío mientras la solicitud sigue en curso: en Cloud Run,
 * con CPU solo durante las solicitudes, un lote que esperara al temporizador podría quedarse
 * en cola hasta la siguiente llamada.
 */
export const traceToolCall: ToolTracer = (call) => {
  try {
    const t = getTracing()
    if (!t) return
    emitToolSpans(t, call)
    void t.provider.forceFlush().catch(() => {})
  } catch (e) {
    console.warn('[tracing] no se pudo registrar la traza:', e instanceof Error ? e.message : e)
  }
}
