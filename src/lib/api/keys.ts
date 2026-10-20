import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { Role } from '@/types'

import { MAX_KEYS_PER_USER, TOKEN_PREFIX, EXPIRY_OPTIONS_DAYS, DEFAULT_EXPIRY_DAYS, SCOPES, ADMIN_ONLY_SCOPES, type Scope } from './constants'

export { MAX_KEYS_PER_USER, TOKEN_PREFIX, EXPIRY_OPTIONS_DAYS, DEFAULT_EXPIRY_DAYS, SCOPES, ALL_SCOPES, type Scope } from './constants'

export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && value in SCOPES
}

export type ApiKeyErrorCode = 'VALIDATION' | 'LIMIT_REACHED' | 'FORBIDDEN' | 'NOT_FOUND'

export class ApiKeyError extends Error {
  constructor(public code: ApiKeyErrorCode, message: string) {
    super(message)
    this.name = 'ApiKeyError'
  }
}

export interface Actor {
  email: string
  role: Role
}

export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const TOKEN_SHAPE = /^btk_[A-Za-z0-9_-]{43}$/

export interface ApiKeyDTO {
  id: string
  name: string
  description: string | null
  prefix: string
  scopes: Scope[]
  ownerEmail: string
  ownerName: string | null
  status: 'active' | 'expired' | 'revoked'
  expiresAt: string
  lastUsedAt: string | null
  lastUsedIp: string | null
  lastUsedUserAgent: string | null
  useCount: number
  revokedAt: string | null
  createdAt: string
}

type KeyRow = NonNullable<Awaited<ReturnType<typeof prisma.apiKey.findUnique>>>

function keyStatus(k: Pick<KeyRow, 'revokedAt' | 'expiresAt'>): ApiKeyDTO['status'] {
  if (k.revokedAt) return 'revoked'
  if (k.expiresAt.getTime() <= Date.now()) return 'expired'
  return 'active'
}

function toDTO(k: KeyRow, ownerName: string | null = null): ApiKeyDTO {
  return {
    id: k.id,
    name: k.name,
    description: k.description,
    prefix: k.prefix,
    scopes: k.scopes.filter(isScope),
    ownerEmail: k.ownerEmail,
    ownerName,
    status: keyStatus(k),
    expiresAt: k.expiresAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    lastUsedIp: k.lastUsedIp,
    lastUsedUserAgent: k.lastUsedUserAgent,
    useCount: k.useCount,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
  }
}

function cleanName(name: unknown): string {
  const v = typeof name === 'string' ? name.trim() : ''
  if (v.length < 1 || v.length > 60) throw new ApiKeyError('VALIDATION', 'El nombre es obligatorio (máximo 60 caracteres).')
  return v
}

function cleanDescription(description: unknown): string | null {
  if (description === undefined || description === null || description === '') return null
  if (typeof description !== 'string' || description.trim().length > 200) {
    throw new ApiKeyError('VALIDATION', 'La descripción admite máximo 200 caracteres.')
  }
  return description.trim()
}

function cleanScopes(scopes: unknown, ownerRole: Role): Scope[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new ApiKeyError('VALIDATION', 'Selecciona al menos un permiso (scope).')
  }
  const unique = Array.from(new Set(scopes))
  const invalid = unique.filter((s) => !isScope(s))
  if (invalid.length > 0) throw new ApiKeyError('VALIDATION', `Scopes inválidos: ${invalid.map(String).join(', ')}`)
  const valid = unique as Scope[]
  if (ownerRole !== 'ADMIN') {
    const forbidden = valid.filter((s) => ADMIN_ONLY_SCOPES.includes(s))
    if (forbidden.length > 0) {
      throw new ApiKeyError('FORBIDDEN', `El scope ${forbidden.join(', ')} solo puede otorgarse a tokens de un ADMIN.`)
    }
  }
  return valid
}

async function ownerRoleOf(email: string): Promise<Role> {
  const user = await prisma.user.findUnique({ where: { email }, select: { role: true } })
  return (user?.role as Role | undefined) ?? 'VIEWER'
}

function activeWhere(ownerEmail: string) {
  return { ownerEmail, revokedAt: null, expiresAt: { gt: new Date() } }
}

export interface CreateApiKeyInput {
  name: unknown
  description?: unknown
  scopes: unknown
  expiresInDays?: unknown
}

/** Crea un token. El valor en claro solo se devuelve aquí, nunca se vuelve a poder leer. */
export async function createApiKey(owner: Actor, input: CreateApiKeyInput): Promise<{ token: string; key: ApiKeyDTO }> {
  const name = cleanName(input.name)
  const description = cleanDescription(input.description)
  const scopes = cleanScopes(input.scopes, owner.role)
  const days = input.expiresInDays === undefined ? DEFAULT_EXPIRY_DAYS : Number(input.expiresInDays)
  if (!(EXPIRY_OPTIONS_DAYS as readonly number[]).includes(days)) {
    throw new ApiKeyError('VALIDATION', `La vigencia debe ser una de: ${EXPIRY_OPTIONS_DAYS.join(', ')} días.`)
  }

  const token = generateToken()
  const created = await prisma.$transaction(async (tx) => {
    // El lock por usuario evita que dos creaciones simultáneas sobrepasen el límite.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'apikey:' + owner.email}))`
    const active = await tx.apiKey.count({ where: activeWhere(owner.email) })
    if (active >= MAX_KEYS_PER_USER) {
      throw new ApiKeyError(
        'LIMIT_REACHED',
        `Alcanzaste el máximo de ${MAX_KEYS_PER_USER} tokens activos. Revoca uno para crear otro.`
      )
    }
    return tx.apiKey.create({
      data: {
        name,
        description,
        prefix: token.slice(0, TOKEN_PREFIX.length + 6),
        keyHash: hashToken(token),
        scopes,
        ownerEmail: owner.email,
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    })
  })

  return { token, key: toDTO(created) }
}

/** Sin `ownerEmail` lista todos los tokens (uso exclusivo del panel de admin). */
export async function listApiKeys(opts: { ownerEmail?: string } = {}): Promise<ApiKeyDTO[]> {
  const rows = await prisma.apiKey.findMany({
    where: opts.ownerEmail ? { ownerEmail: opts.ownerEmail } : undefined,
    orderBy: { createdAt: 'desc' },
  })
  const emails = Array.from(new Set(rows.map((r) => r.ownerEmail)))
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true, name: true } })
  const names = new Map(users.map((u) => [u.email, u.name]))
  return rows.map((r) => toDTO(r, names.get(r.ownerEmail) ?? null))
}

async function loadManageable(id: string, actor: Actor): Promise<KeyRow> {
  const key = await prisma.apiKey.findUnique({ where: { id } })
  // Un no-dueño recibe el mismo NOT_FOUND que un id inexistente para no revelar qué ids existen.
  if (!key || (key.ownerEmail !== actor.email && actor.role !== 'ADMIN')) {
    throw new ApiKeyError('NOT_FOUND', 'Token no encontrado.')
  }
  return key
}

export interface UpdateApiKeyInput {
  name?: unknown
  description?: unknown
  scopes?: unknown
  /** Nueva vigencia en días a partir de ahora. Solo ADMIN. */
  expiresInDays?: unknown
}

export async function updateApiKey(id: string, actor: Actor, input: UpdateApiKeyInput): Promise<ApiKeyDTO> {
  const key = await loadManageable(id, actor)
  if (key.revokedAt) throw new ApiKeyError('VALIDATION', 'No se puede editar un token revocado.')

  const data: Record<string, unknown> = {}
  if (input.name !== undefined) data.name = cleanName(input.name)
  if (input.description !== undefined) data.description = cleanDescription(input.description)
  if (input.scopes !== undefined) data.scopes = cleanScopes(input.scopes, await ownerRoleOf(key.ownerEmail))
  if (input.expiresInDays !== undefined) {
    if (actor.role !== 'ADMIN') throw new ApiKeyError('FORBIDDEN', 'Solo un ADMIN puede cambiar la vigencia de un token.')
    const days = Number(input.expiresInDays)
    if (!(EXPIRY_OPTIONS_DAYS as readonly number[]).includes(days)) {
      throw new ApiKeyError('VALIDATION', `La vigencia debe ser una de: ${EXPIRY_OPTIONS_DAYS.join(', ')} días.`)
    }
    data.expiresAt = new Date(Date.now() + days * 86_400_000)
  }
  if (Object.keys(data).length === 0) throw new ApiKeyError('VALIDATION', 'No hay cambios para guardar.')

  const updated = await prisma.apiKey.update({ where: { id }, data })
  return toDTO(updated)
}

export async function revokeApiKey(id: string, actor: Actor): Promise<void> {
  const key = await loadManageable(id, actor)
  if (key.revokedAt) return
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date(), revokedByEmail: actor.email } })
}

export type VerifyResult =
  | { ok: true; key: KeyRow }
  | { ok: false; reason: 'malformed' | 'unknown' | 'revoked' | 'expired' }

export async function verifyApiKey(token: string): Promise<VerifyResult> {
  if (!TOKEN_SHAPE.test(token)) return { ok: false, reason: 'malformed' }
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hashToken(token) } })
  if (!key) return { ok: false, reason: 'unknown' }
  if (key.revokedAt) return { ok: false, reason: 'revoked' }
  if (key.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' }
  return { ok: true, key }
}

export interface ApiKeyUsage {
  last24h: number
  last7d: number
  byStatus: Record<string, number>
  ips: string[]
  recent: { timestamp: string; method: string; path: string; status: number; ip: string | null; userAgent: string | null; durationMs: number }[]
}

/** Cómo se está consumiendo un token: volumen, códigos de respuesta, IPs y últimas llamadas. */
export async function getApiKeyUsage(id: string, actor: Actor, recentLimit = 25): Promise<ApiKeyUsage> {
  await loadManageable(id, actor)
  const now = Date.now()
  const since7d = new Date(now - 7 * 86_400_000)
  const since24h = new Date(now - 86_400_000)

  const [recent, last24h, last7d, statuses, ips] = await Promise.all([
    prisma.apiRequestLog.findMany({ where: { apiKeyId: id }, orderBy: { timestamp: 'desc' }, take: Math.min(recentLimit, 100) }),
    prisma.apiRequestLog.count({ where: { apiKeyId: id, timestamp: { gte: since24h } } }),
    prisma.apiRequestLog.count({ where: { apiKeyId: id, timestamp: { gte: since7d } } }),
    prisma.apiRequestLog.groupBy({ by: ['status'], where: { apiKeyId: id, timestamp: { gte: since7d } }, _count: { _all: true } }),
    prisma.apiRequestLog.findMany({
      where: { apiKeyId: id, timestamp: { gte: since7d }, ip: { not: null } },
      distinct: ['ip'],
      select: { ip: true },
      take: 20,
    }),
  ])

  return {
    last24h,
    last7d,
    byStatus: Object.fromEntries(statuses.map((s) => [String(s.status), s._count._all])),
    ips: ips.map((r) => r.ip!).filter(Boolean),
    recent: recent.map((r) => ({
      timestamp: r.timestamp.toISOString(),
      method: r.method,
      path: r.path,
      status: r.status,
      ip: r.ip,
      userAgent: r.userAgent,
      durationMs: r.durationMs,
    })),
  }
}
