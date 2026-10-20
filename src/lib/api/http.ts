import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Caller } from '@/lib/mcp/auth'
import type { Role } from '@/types'
import { verifyApiKey, type Scope } from './keys'
import { keyLimiter, failedAuthLimiter, FAILED_AUTH_MAX } from './rate-limit'

export interface ApiContext {
  request: NextRequest
  caller: Caller
  keyId: string
  keyName: string
  scopes: Scope[]
  params: Record<string, string>
}

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

export function apiJson(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { ...BASE_HEADERS, ...extra } })
}

export function apiError(status: number, code: string, message: string, extra: Record<string, string> = {}) {
  return apiJson({ error: { code, message } }, status, extra)
}

/**
 * Los handlers compartidos con el MCP devuelven `{ error: "..." }` con 200.
 * Aquí se traducen a un código HTTP según el mensaje.
 */
export function toolResultResponse(result: Record<string, unknown>, successStatus = 200) {
  const msg = result.error
  if (typeof msg !== 'string') return apiJson(result, successStatus)

  let status = 400
  let code = 'invalid_request'
  if (/no encontrado/i.test(msg)) [status, code] = [404, 'not_found']
  else if (/no puedes|requiere rol|solo su autor|solo un admin/i.test(msg)) [status, code] = [403, 'forbidden']

  const error: Record<string, unknown> = { code, message: msg }
  if (result.details !== undefined) error.details = result.details
  return apiJson({ error }, status)
}

/** IP del cliente. Cloud Run agrega la IP real al final de X-Forwarded-For; lo anterior lo controla el cliente. */
export function clientIp(request: NextRequest): string | null {
  const xff = request.headers.get('x-forwarded-for')
  const last = xff?.split(',').pop()?.trim()
  if (!last || !/^[0-9a-fA-F:.]{3,45}$/.test(last)) return null
  return last
}

function bearerToken(request: NextRequest): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')
  return m ? m[1] : null
}

const WWW_AUTH = 'Bearer realm="Bitácora Novedades API"'

type Handler = (ctx: ApiContext) => Promise<Response>
type RouteCtx = { params: Promise<Record<string, string>> }

/**
 * Envuelve un endpoint de /api/v1: autentica el token, exige el scope,
 * aplica rate limit, ejecuta el handler y registra el request.
 */
export function apiRoute(scope: Scope | null, handler: Handler) {
  // El segundo argumento es obligatorio en el tipo: el validador de rutas de Next 16 no acepta uno opcional.
  return async (request: NextRequest, routeCtx: RouteCtx): Promise<Response> => {
    const started = Date.now()
    const ip = clientIp(request)
    const ipKey = ip ?? 'unknown'

    if (failedAuthLimiter.peek(ipKey) >= FAILED_AUTH_MAX) {
      return apiError(429, 'too_many_attempts', 'Demasiados intentos con credenciales inválidas. Intenta más tarde.', {
        'Retry-After': '300',
      })
    }

    const token = bearerToken(request)
    if (!token) {
      failedAuthLimiter.hit(ipKey)
      return apiError(401, 'missing_token', 'Falta el header "Authorization: Bearer <token>".', { 'WWW-Authenticate': WWW_AUTH })
    }

    const verified = await verifyApiKey(token)
    if (!verified.ok) {
      failedAuthLimiter.hit(ipKey)
      if (verified.reason === 'expired') {
        return apiError(401, 'token_expired', 'El token expiró. Genera uno nuevo en la Bitácora.', { 'WWW-Authenticate': WWW_AUTH })
      }
      return apiError(401, 'invalid_token', 'Token inválido o revocado.', { 'WWW-Authenticate': WWW_AUTH })
    }
    const key = verified.key

    // El rol se lee en cada request: si bajan o cambian al dueño, el token lo refleja de inmediato.
    const owner = await prisma.user.findUnique({ where: { email: key.ownerEmail } })
    if (!owner) {
      return apiError(401, 'invalid_token', 'Token inválido o revocado.', { 'WWW-Authenticate': WWW_AUTH })
    }

    const rl = keyLimiter.hit(key.id)
    const rlHeaders = {
      'X-RateLimit-Limit': String(rl.limit),
      'X-RateLimit-Remaining': String(rl.remaining),
    }

    const record = async (status: number) => {
      const ua = request.headers.get('user-agent')?.slice(0, 200) ?? null
      try {
        await prisma.$transaction([
          prisma.apiRequestLog.create({
            data: {
              apiKeyId: key.id,
              method: request.method,
              path: request.nextUrl.pathname.slice(0, 200),
              status,
              ip,
              userAgent: ua,
              durationMs: Date.now() - started,
            },
          }),
          prisma.apiKey.update({
            where: { id: key.id },
            data: { lastUsedAt: new Date(), lastUsedIp: ip, lastUsedUserAgent: ua, useCount: { increment: 1 } },
          }),
        ])
      } catch (e) {
        console.error('[api] no se pudo registrar el request:', e)
      }
    }

    let response: Response
    if (!rl.allowed) {
      response = apiError(429, 'rate_limited', 'Superaste el límite de requests por minuto para este token.', {
        ...rlHeaders,
        'Retry-After': String(rl.retryAfterSec),
      })
    } else if (scope && !key.scopes.includes(scope)) {
      response = apiError(403, 'insufficient_scope', `Este token no tiene el scope "${scope}".`, rlHeaders)
    } else {
      try {
        const caller: Caller = {
          id: owner.id,
          email: owner.email,
          name: owner.name,
          role: owner.role as Role,
          via: { channel: 'api', apiKeyId: key.id, apiKeyName: key.name },
        }
        response = await handler({
          request,
          caller,
          keyId: key.id,
          keyName: key.name,
          scopes: key.scopes as Scope[],
          params: (await routeCtx?.params) ?? {},
        })
        for (const [k, v] of Object.entries(rlHeaders)) response.headers.set(k, v)
      } catch (e) {
        console.error('[api] error no controlado:', e)
        response = apiError(500, 'internal_error', 'Error interno del servidor.', rlHeaders)
      }
    }

    await record(response.status)
    return response
  }
}
