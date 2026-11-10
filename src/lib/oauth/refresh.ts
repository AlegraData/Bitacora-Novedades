// Renovación de tokens OAuth del MCP: rotación atómica, gracia para reintentos y freno a los bucles.
//
// Contexto (nov-2026): clientes MCP (Hermes-Agent y otros) reintentaban /oauth/token cada pocos segundos con un refresh
// token ya rotado o vencido y recibían 400 invalid_grant para siempre (~40 % de las respuestas eran 4xx). Se corrige
// sin aflojar la seguridad (mismo diseño que Meet Wiki, PR #20):
//   1. La rotación es atómica: dos refresh simultáneos con el mismo token no pueden crear dos sesiones.
//   2. Un refresh token recién rotado (<= REFRESH_GRACE_MS) devuelve los tokens de su sucesor: un cliente que perdió la
//      respuesta, o que renovó en paralelo, se recupera en vez de quedar bloqueado. Una revocación manual o una nueva
//      autorización nunca se resucitan.
//   3. Se registra el motivo de cada rechazo (sin tokens) y se frena a quien insiste con 429 + Retry-After.
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'

export const ACCESS_TTL_MS = 15 * 60 * 1000 // 15 min
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 días
export const REFRESH_GRACE_MS = 30 * 1000 // ventana en la que un refresh token ya rotado todavía se acepta

export type RejectReason = 'unknown_token' | 'revoked' | 'expired' | 'client_mismatch'

export type RefreshResult =
  | { ok: true; accessToken: string; refreshToken: string; graceReplay: boolean }
  | { ok: false; reason: RejectReason }

interface SessionRow {
  id: string
  userEmail: string
  clientId: string
  clientName: string | null
  refreshExpiresAt: Date
  revokedAt: Date | null
}

/** Lo mínimo que se usa de Prisma: permite probar la lógica con un acceso a datos falso y con estado. */
export interface OAuthDb {
  oAuthSession: {
    findUnique(args: { where: Record<string, unknown> }): Promise<SessionRow | null>
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{ accessToken: string; refreshToken: string } | null>
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
    create(args: { data: Record<string, unknown> }): Promise<unknown>
  }
  $transaction<T>(fn: (tx: OAuthDb) => Promise<T>): Promise<T>
}

// Acceso a datos por defecto; las pruebas lo reemplazan por uno falso con estado.
let defaultDb: OAuthDb = prisma as unknown as OAuthDb
export function setOAuthDbForTests(db: OAuthDb | null): void {
  defaultDb = db ?? (prisma as unknown as OAuthDb)
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * clientId puede venir vacío (algunos clientes no lo envían al renovar): si viene, debe coincidir con el de la sesión.
 */
export async function refreshSession(
  refreshToken: string,
  clientId: string | null,
  now: Date = new Date(),
  db: OAuthDb = defaultDb
): Promise<RefreshResult> {
  const session = await db.oAuthSession.findUnique({ where: { refreshToken } })
  if (!session) return { ok: false, reason: 'unknown_token' }
  if (clientId && session.clientId !== clientId) return { ok: false, reason: 'client_mismatch' }
  if (session.refreshExpiresAt < now) return { ok: false, reason: 'expired' }

  if (!session.revokedAt) {
    const rotated = await rotate(db, session, now)
    if (rotated) return { ok: true, ...rotated, graceReplay: false }
    // Otro refresh simultáneo lo rotó justo antes: se trata como reintento (gracia).
    const fresh = await db.oAuthSession.findUnique({ where: { id: session.id } })
    return replayFromSuccessor(db, session, fresh?.revokedAt ?? now, now)
  }

  return replayFromSuccessor(db, session, session.revokedAt, now)
}

// Revoca la sesión SOLO si sigue vigente (updateMany condicionado) y crea la sucesora en la misma transacción.
// Devuelve null si otro refresh ganó la carrera. createdAt de la sucesora = revokedAt de la anterior: así se localiza
// sin columnas nuevas, y una revocación manual o una nueva autorización (otro instante) nunca coinciden.
async function rotate(
  db: OAuthDb,
  session: SessionRow,
  now: Date
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const accessToken = generateToken()
  const refreshToken = generateToken()
  const won = await db.$transaction(async (tx) => {
    const claimed = await tx.oAuthSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: now },
    })
    if (claimed.count === 0) return false
    await tx.oAuthSession.create({
      data: {
        accessToken,
        refreshToken,
        userEmail: session.userEmail,
        clientId: session.clientId,
        clientName: session.clientName,
        createdAt: now,
        expiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
        refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
      },
    })
    return true
  })
  return won ? { accessToken, refreshToken } : null
}

async function replayFromSuccessor(db: OAuthDb, session: SessionRow, revokedAt: Date, now: Date): Promise<RefreshResult> {
  if (now.getTime() - revokedAt.getTime() > REFRESH_GRACE_MS) return { ok: false, reason: 'revoked' }
  const successor = await db.oAuthSession.findFirst({
    where: {
      userEmail: session.userEmail,
      clientId: session.clientId,
      createdAt: revokedAt, // solo una rotación (no una revocación manual) crea la sucesora con este instante exacto
      revokedAt: null,
      refreshExpiresAt: { gt: now },
    },
    select: { accessToken: true, refreshToken: true },
  })
  if (!successor) return { ok: false, reason: 'revoked' }
  return { ok: true, accessToken: successor.accessToken, refreshToken: successor.refreshToken, graceReplay: true }
}

// ── Registro del rechazo (sin tokens, sin datos personales) ────────────────────────────────────────────────────────
export function logRejection(reason: RejectReason, clientId: string | null, userAgent: string | null, limited = false): void {
  // JSON en una línea: lo que controla el cliente (user-agent, client_id) no puede romper el formato del log.
  console.warn(
    JSON.stringify({
      event: 'oauth_refresh_rejected',
      reason,
      limited,
      clientId: clientId ? clientId.slice(0, 40) : null,
      userAgent: userAgent ? userAgent.replace(/[^\x20-\x7e]/g, '?').slice(0, 80) : null,
    })
  )
}

// ── Freno a los bucles: tras demasiados rechazos seguidos del mismo cliente, 429 + Retry-After ──────────────────────
// En memoria y por instancia: protección de mejor esfuerzo (reduce carga y enseña a retroceder), no un control de acceso.
export const LIMIT_MAX_FAILURES = 10
export const LIMIT_WINDOW_MS = 60 * 1000
const MAX_KEYS = 5000
const failures = new Map<string, number[]>()

export function limiterKey(ip: string | null, clientId: string | null): string {
  return `${ip ?? '?'}|${(clientId ?? '?').slice(0, 64)}`
}

function recent(key: string, now: number): number[] {
  const list = (failures.get(key) ?? []).filter((t) => now - t < LIMIT_WINDOW_MS)
  if (list.length) failures.set(key, list)
  else failures.delete(key)
  return list
}

/** Segundos que debe esperar el cliente, o 0 si puede intentar. */
export function retryAfterSeconds(key: string, now = Date.now()): number {
  const list = recent(key, now)
  if (list.length < LIMIT_MAX_FAILURES) return 0
  return Math.max(1, Math.ceil((list[0] + LIMIT_WINDOW_MS - now) / 1000))
}

export function recordFailure(key: string, now = Date.now()): void {
  const list = recent(key, now)
  list.push(now)
  failures.set(key, list)
  if (failures.size > MAX_KEYS) failures.delete(failures.keys().next().value as string) // acota la memoria
}

export function recordSuccess(key: string): void {
  failures.delete(key)
}

export function resetLimiterForTests(): void {
  failures.clear()
}
