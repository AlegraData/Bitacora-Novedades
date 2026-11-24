import { NextRequest, NextResponse } from 'next/server'
import { oauthCorsHeaders } from '@/lib/oauth/cors'
import { publicOrigin, wwwAuthenticate } from '@/lib/oauth/metadata'
import { resolveCaller, type Caller } from '@/lib/mcp/auth'
import { addAuditLog } from '@/lib/actions/audit'
import { logToolCall, statusOfResult, type CallStatus } from '@/lib/mcp/call-log'
import {
  ANSWER_RATE_LIMITED_MESSAGE,
  ANSWER_RECORDED,
  ANSWER_TOOL,
  CONVERSATION_INSTRUCTIONS,
  INVALID_ANSWER_MESSAGE,
  MISSING_QUESTION_MESSAGE,
  STRICT_REASON,
  captureEnabled,
  clipText,
  createRateLimiter,
  missingQuestion,
  requireQuestion,
  splitQuestion,
  toolsWithConversation,
  validAnswerArguments,
} from '@/lib/mcp/conversation'
import { errorCodeOf, traceToolCall } from '@/lib/mcp/tracing'
import {
  TOOLS,
  handleListRecords,
  handleGetRecord,
  handleSearchRecordsSemantic,
  handleCreateRecord,
  handleUpdateRecord,
  handleDeleteRecord,
  handleNotifyPmkt,
  handleListAuditLog,
  handleListEmailDeliveries,
} from '@/lib/mcp/tools'

const SERVER_INFO = { name: 'bitacora-novedades-mcp', version: '1.0.0' }
const PROTOCOL_VERSION = '2025-06-18'

// Captura de la conversación (lib/mcp/conversation.ts): con MCP_CAPTURE_CONVERSATION=true cada
// herramienta pide `pregunta_usuario` y existe `registrar_respuesta`; con MCP_REQUIRE_QUESTION=true,
// además, una llamada sin pregunta no se ejecuta. Respuestas registradas: 30 por minuto por cuenta.
const answerLimiter = createRateLimiter(30, 60_000)

const READ_ACTIONS: Record<string, string> = {
  list_records: 'MCP_LISTED_RECORDS',
  get_record: 'MCP_VIEWED_RECORD',
  search_records_semantic: 'MCP_SEARCHED_RECORDS',
  list_audit_log: 'MCP_VIEWED_AUDIT_LOG',
  list_email_deliveries: 'MCP_LISTED_EMAIL_DELIVERIES',
}

async function logMcpRead(toolName: string, toolArgs: Record<string, unknown>, caller: Caller) {
  const action = READ_ACTIONS[toolName]
  if (!action) return

  const recordId =
    typeof toolArgs.id === 'string' ? toolArgs.id : typeof toolArgs.recordId === 'string' ? toolArgs.recordId : null

  try {
    await addAuditLog({
      userId: caller.id,
      userEmail: caller.email,
      userName: caller.name ?? caller.email,
      action,
      recordId,
      details: { via: 'mcp', tool: toolName, args: toolArgs },
    })
  } catch (error) {
    console.error('Error registrando lectura de MCP en auditoría:', error)
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: oauthCorsHeaders() })
}

function jsonRpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result }, { headers: oauthCorsHeaders() })
}

function jsonRpcError(id: unknown, code: number, message: string, status = 200) {
  return NextResponse.json(
    { jsonrpc: '2.0', id, error: { code, message } },
    { status, headers: oauthCorsHeaders() }
  )
}

function toolTextResult(data: unknown) {
  return toolText(JSON.stringify(data))
}

function toolText(text: string, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const id = body?.id ?? null
  const method = body?.method

  if (!body || typeof method !== 'string') {
    return jsonRpcError(id, -32600, 'Invalid Request', 400)
  }

  // Todo requiere un caller autenticado vía OAuth, incluido "initialize" —
  // los clientes MCP (ej. OpenCode) usan la respuesta a la primera llamada
  // para decidir si disparan el flujo OAuth; si initialize responde 200 sin
  // auth, algunos clientes nunca intentan autenticarse.
  const caller = await resolveCaller(request)
  if (!caller) {
    return NextResponse.json(
      { jsonrpc: '2.0', id, error: { code: -32001, message: 'Unauthorized' } },
      {
        status: 401,
        // Solo ASCII (el Google Frontend de Cloud Run descarta el encabezado si no; ver lib/api/http.ts) y con
        // resource_metadata para que el cliente descubra el servidor de autorización (RFC 9728).
        headers: { ...oauthCorsHeaders(), 'WWW-Authenticate': wwwAuthenticate(publicOrigin(request.headers, request.url)) },
      }
    )
  }

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      ...(captureEnabled() ? { instructions: CONVERSATION_INSTRUCTIONS } : {}),
    })
  }

  if (method === 'notifications/initialized') {
    return new NextResponse(null, { status: 202, headers: oauthCorsHeaders() })
  }

  if (method === 'tools/list') {
    const tools = TOOLS.map(({ requiredRole: _r, ...tool }) => { void _r; return tool })
    // Con la captura activa: pregunta_usuario obligatoria en cada herramienta + registrar_respuesta.
    return jsonRpcResult(id, { tools: captureEnabled() ? toolsWithConversation(tools) : tools })
  }

  if (method === 'tools/call') {
    const toolName = body?.params?.name
    const name = String(toolName)
    // pregunta_usuario se retira SIEMPRE antes de ejecutar: ni la herramienta, ni la auditoría
    // (AuditLog), ni el registro de llamadas del admin la ven. Solo va a Phoenix.
    const { question, args: toolArgs } = splitQuestion(body?.params?.arguments ?? {})
    const startedAt = Date.now()

    // Cada llamada queda en dos registros a la par: el del admin (Conexiones MCP, sin contenido)
    // y la traza en Phoenix, que no espera a Phoenix ni puede romper la herramienta.
    const finish = async (
      status: CallStatus,
      detail: string | null,
      errorMessage: string | null,
      extra: { result?: unknown; resultText?: string; answer?: string | null; error?: unknown; skipCallLog?: boolean } = {}
    ) => {
      const durationMs = Date.now() - startedAt
      traceToolCall({
        userEmail: caller.email,
        sessionId: caller.session?.id ?? '',
        clientName: caller.session?.clientName ?? null,
        role: caller.role,
        userAgent: request.headers.get('user-agent'),
        tool: name,
        args: toolArgs,
        question,
        answer: extra.answer ?? null,
        status,
        detail,
        startedAt,
        durationMs,
        result: extra.result,
        resultText: extra.resultText ?? null,
        error: extra.error,
      })
      if (!extra.skipCallLog) await logToolCall({ caller, tool: name, args: toolArgs, status, errorMessage, durationMs })
    }

    // registrar_respuesta (solo con la captura activa): no toca la Bitácora; responde un texto
    // fijo y la respuesta solo llega a Phoenix. Queda exenta del modo estricto.
    if (captureEnabled() && toolName === ANSWER_TOOL) {
      if (!validAnswerArguments(toolArgs)) {
        await finish('error', 'invalid_args', INVALID_ANSWER_MESSAGE, { resultText: INVALID_ANSWER_MESSAGE })
        return jsonRpcResult(id, toolText(INVALID_ANSWER_MESSAGE, true))
      }
      if (!answerLimiter.allow(caller.email)) {
        await finish('denied', 'rate_limited', 'Demasiadas respuestas registradas en poco tiempo.', { resultText: ANSWER_RATE_LIMITED_MESSAGE })
        return jsonRpcResult(id, toolText(ANSWER_RATE_LIMITED_MESSAGE, true))
      }
      await finish('ok', null, null, { resultText: ANSWER_RECORDED, answer: clipText(toolArgs.respuesta) })
      return jsonRpcResult(id, toolText(ANSWER_RECORDED))
    }

    const tool = TOOLS.find((t) => t.name === toolName)
    if (!tool) {
      // Como antes, una herramienta inexistente no entra al registro del admin; en Phoenix sí.
      await finish('error', 'unknown_tool', null, { skipCallLog: true })
      return jsonRpcError(id, -32601, `Tool "${toolName}" not found`)
    }

    // Modo estricto: sin pregunta_usuario la llamada no se ejecuta. Es un error de HERRAMIENTA
    // (el cliente no se desconecta) que le dice al agente qué mandar.
    if (requireQuestion() && missingQuestion(name, question)) {
      await finish('denied', STRICT_REASON, 'Falta pregunta_usuario (modo estricto).', { resultText: MISSING_QUESTION_MESSAGE })
      return jsonRpcResult(id, toolText(MISSING_QUESTION_MESSAGE, true))
    }

    if (tool.requiredRole && caller.role !== tool.requiredRole) {
      const denied = { error: `Esta acción requiere rol ${tool.requiredRole}.` }
      await finish('denied', 'forbidden_role', denied.error, { result: denied, resultText: JSON.stringify(denied) })
      return jsonRpcResult(id, toolTextResult(denied))
    }

    try {
      let result: unknown
      switch (toolName) {
        case 'list_records':
          result = await handleListRecords(toolArgs)
          break
        case 'get_record':
          result = await handleGetRecord(toolArgs)
          break
        case 'search_records_semantic':
          result = await handleSearchRecordsSemantic(toolArgs)
          break
        case 'create_record':
          result = await handleCreateRecord(toolArgs, caller)
          break
        case 'update_record':
          result = await handleUpdateRecord(toolArgs, caller)
          break
        case 'delete_record':
          result = await handleDeleteRecord(toolArgs, caller)
          break
        case 'notify_pmkt':
          result = await handleNotifyPmkt(toolArgs, caller)
          break
        case 'list_audit_log':
          result = await handleListAuditLog(toolArgs)
          break
        case 'list_email_deliveries':
          result = await handleListEmailDeliveries(toolArgs, caller)
          break
        default:
          return jsonRpcError(id, -32601, `Tool "${toolName}" not implemented`)
      }

      await logMcpRead(toolName, toolArgs, caller)
      const outcome = statusOfResult(result)
      const text = JSON.stringify(result)
      await finish(outcome.status, errorCodeOf(result, outcome.status), outcome.message, { result, resultText: text })

      return jsonRpcResult(id, toolText(text))
    } catch (error) {
      console.error(`Error ejecutando tool "${toolName}":`, error)
      await finish('error', 'exception', 'Internal tool error', { error })
      return jsonRpcError(id, -32000, 'Internal tool error')
    }
  }

  return jsonRpcError(id, -32601, `Method "${method}" not found`)
}
