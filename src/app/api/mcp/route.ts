import { NextRequest, NextResponse } from 'next/server'
import { oauthCorsHeaders } from '@/lib/oauth/cors'
import { resolveCaller } from '@/lib/mcp/auth'
import {
  TOOLS,
  handleListRecords,
  handleGetRecord,
  handleSearchRecordsSemantic,
  handleCreateRecord,
  handleUpdateRecord,
  handleDeleteRecord,
} from '@/lib/mcp/tools'

const SERVER_INFO = { name: 'bitacora-novedades-mcp', version: '1.0.0' }
const PROTOCOL_VERSION = '2025-06-18'

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
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const id = body?.id ?? null
  const method = body?.method

  if (!body || typeof method !== 'string') {
    return jsonRpcError(id, -32600, 'Invalid Request', 400)
  }

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    })
  }

  if (method === 'notifications/initialized') {
    return new NextResponse(null, { status: 202, headers: oauthCorsHeaders() })
  }

  // A partir de aquí, todo requiere un caller autenticado vía OAuth.
  const caller = await resolveCaller(request)
  if (!caller) {
    return NextResponse.json(
      { jsonrpc: '2.0', id, error: { code: -32001, message: 'Unauthorized' } },
      { status: 401, headers: { ...oauthCorsHeaders(), 'WWW-Authenticate': 'Bearer' } }
    )
  }

  if (method === 'tools/list') {
    return jsonRpcResult(id, { tools: TOOLS.map(({ requiredRole: _r, ...tool }) => { void _r; return tool }) })
  }

  if (method === 'tools/call') {
    const toolName = body?.params?.name
    const toolArgs = body?.params?.arguments ?? {}

    const tool = TOOLS.find((t) => t.name === toolName)
    if (!tool) {
      return jsonRpcError(id, -32601, `Tool "${toolName}" not found`)
    }

    if (tool.requiredRole && caller.role !== tool.requiredRole) {
      return jsonRpcResult(id, toolTextResult({ error: `Esta acción requiere rol ${tool.requiredRole}.` }))
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
        default:
          return jsonRpcError(id, -32601, `Tool "${toolName}" not implemented`)
      }
      return jsonRpcResult(id, toolTextResult(result))
    } catch (error) {
      console.error(`Error ejecutando tool "${toolName}":`, error)
      return jsonRpcError(id, -32000, 'Internal tool error')
    }
  }

  return jsonRpcError(id, -32601, `Method "${method}" not found`)
}
