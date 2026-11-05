// Contrato de salud que consulta el monitor del IT Hub (alegra-it-hub-backend/docs/MONITOR_MODULE.md §3).
//
// El endpoint es público en Cloud Run (--allow-unauthenticated), así que TODA la protección está aquí:
//   - solo entra UNA cuenta de servicio (la del monitor, MONITOR_SA_EMAIL) con un token OIDC de Google cuya
//     audiencia es el origen público de la app;
//   - sin MONITOR_SA_EMAIL o sin audiencia configurada el endpoint queda cerrado;
//   - la misma respuesta 401 para cualquier causa de rechazo (no se revela si falló el token, la audiencia o la cuenta);
//   - no devuelve secretos ni datos de negocio, y el detalle de error es genérico (el mensaje de Prisma/pg puede traer
//     host, usuario o la cadena de conexión).
// Se escribe como fábrica con dependencias inyectables para poder probar la seguridad sin base de datos ni red.
import { NextResponse } from 'next/server'

export interface MonitorCheck {
  name: string
  status: 'ok' | 'degraded' | 'down'
  latencyMs?: number
  detail?: string
}

export interface MonitorJob {
  name: string
  ok: boolean
  lastRunAt: string | null
  detail?: string
}

export type TokenPayload = { email?: string; email_verified?: boolean } | undefined

export interface MonitorDeps {
  /** Valida firma, expiración y audiencia del token OIDC; lanza si no es válido. */
  verifyToken: (idToken: string, audience: string) => Promise<TokenPayload>
  /** Lanza si la base de datos no responde. */
  checkDatabase: () => Promise<void>
  /** Cuenta del monitor, audiencia esperada y revisión desplegada. Se lee en cada petición (no en la carga del módulo). */
  config: () => { monitorSaEmail?: string; audience?: string; version?: string | null }
  checkTimeoutMs?: number
}

const NO_STORE = { 'Cache-Control': 'no-store' }

/** Puro: ¿estos claims del token OIDC son de la cuenta del monitor? Sin cuenta configurada nadie entra. */
export function isMonitorPayload(payload: TokenPayload, expectedEmail: string | undefined): boolean {
  if (!payload || !expectedEmail) return false
  return payload.email_verified === true && payload.email?.toLowerCase() === expectedEmail.toLowerCase()
}

/** Estado global: la app calcula el suyo. "down" si la base cae; "degraded" si algo más falla. */
export function buildMonitorStatus(input: { checks: MonitorCheck[]; jobs: MonitorJob[]; version: string | null }) {
  const status = input.checks.some((c) => c.status === 'down')
    ? 'down'
    : input.checks.some((c) => c.status !== 'ok') || input.jobs.some((j) => !j.ok)
      ? 'degraded'
      : 'ok'
  return { status, version: input.version, checks: input.checks, jobs: input.jobs, freshness: [] as unknown[] }
}

export function createMonitorStatusHandler(deps: MonitorDeps) {
  const timeoutMs = deps.checkTimeoutMs ?? 3000

  async function timed(name: string, fn: () => Promise<void>): Promise<MonitorCheck> {
    const started = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
        }),
      ])
      return { name, status: 'ok', latencyMs: Date.now() - started }
    } catch (e) {
      return { name, status: 'down', latencyMs: Date.now() - started, detail: e instanceof Error && e.message === 'timeout' ? 'timeout' : 'error' }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async function isAuthorized(authorization: string | null, cfg: ReturnType<MonitorDeps['config']>): Promise<boolean> {
    const match = authorization?.match(/^Bearer\s+(\S+)$/i)
    if (!cfg.audience || !cfg.monitorSaEmail || !match) return false
    try {
      return isMonitorPayload(await deps.verifyToken(match[1], cfg.audience), cfg.monitorSaEmail)
    } catch {
      return false
    }
  }

  return async function GET(request: Request): Promise<NextResponse> {
    const cfg = deps.config()
    // Mismo cuerpo para toda causa de rechazo; nada se toca (ni la base) antes de autenticar.
    if (!(await isAuthorized(request.headers.get('authorization'), cfg))) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: NO_STORE })
    }

    const database = await timed('database', deps.checkDatabase)
    // Bitácora no tiene jobs de Cloud Scheduler: el contrato los devuelve vacíos.
    return NextResponse.json(buildMonitorStatus({ checks: [database], jobs: [], version: cfg.version ?? null }), { headers: NO_STORE })
  }
}
