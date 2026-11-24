import { prisma } from '@/lib/prisma'
import { agentOf } from '@/lib/admin/agents'
import type { Caller } from './auth'

export type CallStatus = 'ok' | 'denied' | 'error'

/** Una respuesta de herramienta con `error` es «denegada» si habla de permisos/rol; si no, es un error. */
export function statusOfResult(result: unknown): { status: CallStatus; message: string | null } {
  const err = (result as { error?: unknown } | null)?.error
  if (err === undefined || err === null || err === false) return { status: 'ok', message: null }
  // Los errores del envío de correo (notify_pmkt) son objetos { code, message }: se guarda
  // «CÓDIGO: mensaje» (antes quedaba «[object Object]») y solo FORBIDDEN cuenta como denegada.
  if (typeof err === 'object') {
    const { code, message } = err as { code?: unknown; message?: unknown }
    const text = [code, message].filter((v): v is string => typeof v === 'string' && v.length > 0).join(': ') || 'Error'
    return { status: code === 'FORBIDDEN' ? 'denied' : 'error', message: text.slice(0, 300) }
  }
  const message = String(err).slice(0, 300)
  return { status: /permiso|rol |requiere|no autorizad|solo (puede|un)|forbidden/i.test(message) ? 'denied' : 'error', message }
}

/**
 * Registra una llamada a una herramienta del MCP para el dashboard del admin.
 * Nunca guarda los argumentos ni la respuesta, y nunca debe romper la llamada original.
 */
export async function logToolCall(input: { caller: Caller; tool: string; args?: Record<string, unknown>; status: CallStatus; errorMessage?: string | null; durationMs: number }): Promise<void> {
  const { caller, args } = input
  const recordId = typeof args?.id === 'string' ? args.id : typeof args?.recordId === 'string' ? args.recordId : null
  try {
    await prisma.mcpToolCall.create({
      data: {
        userEmail: caller.email,
        sessionId: caller.session?.id ?? null,
        clientName: caller.session?.clientName ?? null,
        agent: agentOf(caller.session?.clientName),
        tool: input.tool.slice(0, 80),
        recordId: recordId ? recordId.slice(0, 60) : null,
        status: input.status,
        errorMessage: input.errorMessage ?? null,
        durationMs: Math.max(0, Math.round(input.durationMs)),
      },
    })
  } catch (e) {
    console.error('[mcp] no se pudo registrar la llamada:', e instanceof Error ? e.message : e)
  }
}
