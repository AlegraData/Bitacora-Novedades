import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma'
import { isScope, type Scope } from '@/lib/api/keys'
import { clampPageSize, paginate, type PageSize } from './table'
import { clampPeriod, dayKey, type Period } from './mcp-dashboard'

// Datos del dashboard «API Tokens»: quién tiene tokens, qué permisos, cuánto se usan y qué consultan.
// Sale de ApiKey y ApiRequestLog (una fila por request autenticado, incluidos los rechazos 401/403/429).

const DAY = 86_400_000

export type ResultClass = 'ok' | 'denied' | 'error'

/** 2xx/3xx = correcta · 401/403/429 = denegada (sin permiso o límite de uso) · el resto de 4xx/5xx = error. */
export function classifyStatus(status: number): ResultClass {
  if (status < 400) return 'ok'
  return status === 401 || status === 403 || status === 429 ? 'denied' : 'error'
}

export interface ApiTokenRowDTO {
  id: string
  name: string
  prefix: string
  scopes: Scope[]
  status: 'active' | 'expiring' | 'expired' | 'revoked'
  createdAt: string
  lastUsedAt: string | null
  lastUsedIp: string | null
  expiresAt: string
  requests: number
}

export interface ApiPersonDTO {
  email: string
  name: string | null
  image: string | null
  activeTokens: number
  lastUsedAt: string | null
  requests: number
  tokens: ApiTokenRowDTO[]
}

export interface ApiOverviewDTO {
  period: Period
  people: number
  activeTokens: number
  requests: number
  results: Record<ResultClass, number>
  byScope: { scope: Scope; count: number }[]
  perDay: { date: string; label: string; value: number }[]
  rows: ApiPersonDTO[]
}

function tokenStatus(k: { revokedAt: Date | null; expiresAt: Date }, now: number): ApiTokenRowDTO['status'] {
  if (k.revokedAt) return 'revoked'
  const left = k.expiresAt.getTime() - now
  if (left <= 0) return 'expired'
  return left < 7 * DAY ? 'expiring' : 'active'
}

export async function getApiOverview(periodInput: unknown = 7, nowMs = Date.now()): Promise<ApiOverviewDTO> {
  const period = clampPeriod(periodInput)
  const since = new Date(nowMs - period * DAY)

  const [keys, logs] = await Promise.all([
    // Tokens vigentes y los que terminaron en los últimos 90 días.
    prisma.apiKey.findMany({
      where: { OR: [{ revokedAt: null, expiresAt: { gt: new Date(nowMs) } }, { createdAt: { gte: new Date(nowMs - 90 * DAY) } }] },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.apiRequestLog.findMany({ where: { timestamp: { gte: since } }, select: { timestamp: true, status: true, apiKeyId: true } }),
  ])

  const users = await prisma.user.findMany({ where: { email: { in: [...new Set(keys.map((k) => k.ownerEmail))] } }, select: { email: true, name: true, image: true } })
  const userMap = new Map(users.map((u) => [u.email, u]))

  const byKey = new Map<string, number>()
  const byOwner = new Map<string, number>()
  const keyOwner = new Map(keys.map((k) => [k.id, k.ownerEmail]))
  const results: Record<ResultClass, number> = { ok: 0, denied: 0, error: 0 }
  const perDayMap = new Map<string, number>()
  for (const l of logs) {
    byKey.set(l.apiKeyId, (byKey.get(l.apiKeyId) ?? 0) + 1)
    const owner = keyOwner.get(l.apiKeyId)
    if (owner) byOwner.set(owner, (byOwner.get(owner) ?? 0) + 1)
    results[classifyStatus(l.status)]++
    const k = dayKey(l.timestamp)
    perDayMap.set(k, (perDayMap.get(k) ?? 0) + 1)
  }

  const perDay: ApiOverviewDTO['perDay'] = []
  for (let i = period - 1; i >= 0; i--) {
    const k = dayKey(new Date(nowMs - i * DAY))
    const [, m, d] = k.split('-')
    perDay.push({ date: k, label: `${Number(d)}/${Number(m)}`, value: perDayMap.get(k) ?? 0 })
  }

  const people = new Map<string, ApiPersonDTO>()
  const scopeCounts = new Map<Scope, number>()
  for (const k of keys) {
    const status = tokenStatus(k, nowMs)
    const u = userMap.get(k.ownerEmail)
    const p = people.get(k.ownerEmail) ?? { email: k.ownerEmail, name: u?.name ?? null, image: u?.image ?? null, activeTokens: 0, lastUsedAt: null, requests: byOwner.get(k.ownerEmail) ?? 0, tokens: [] }
    const scopes = k.scopes.filter(isScope)
    p.tokens.push({
      id: k.id, name: k.name, prefix: k.prefix, scopes, status, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      lastUsedIp: k.lastUsedIp, expiresAt: k.expiresAt.toISOString(), requests: byKey.get(k.id) ?? 0,
    })
    if (status === 'active' || status === 'expiring') {
      p.activeTokens++
      for (const s of scopes) scopeCounts.set(s, (scopeCounts.get(s) ?? 0) + 1)
    }
    if (k.lastUsedAt && (!p.lastUsedAt || k.lastUsedAt.toISOString() > p.lastUsedAt)) p.lastUsedAt = k.lastUsedAt.toISOString()
    people.set(k.ownerEmail, p)
  }
  const rows = [...people.values()].sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') || a.email.localeCompare(b.email))

  return {
    period,
    people: rows.filter((p) => p.activeTokens > 0).length,
    activeTokens: rows.reduce((n, p) => n + p.activeTokens, 0),
    requests: logs.length,
    results,
    byScope: [...scopeCounts.entries()].map(([scope, count]) => ({ scope, count })).sort((a, b) => b.count - a.count),
    perDay,
    rows,
  }
}

// ---------- actividad (requests), paginada en el servidor ----------

export interface ApiActivityFilters {
  q?: unknown
  result?: unknown
  days?: unknown
  page?: unknown
  pageSize?: unknown
}

export interface ApiActivityRow {
  id: string
  timestamp: string
  ownerEmail: string
  ownerName: string | null
  ownerImage: string | null
  tokenName: string
  tokenPrefix: string
  method: string
  path: string
  status: number
  result: ResultClass
  ip: string | null
  userAgent: string | null
  durationMs: number
}

export interface ApiActivityPage {
  rows: ApiActivityRow[]
  page: number
  pageCount: number
  total: number
  from: number
  to: number
  pageSize: PageSize
}

export async function getApiActivity(f: ApiActivityFilters = {}, nowMs = Date.now()): Promise<ApiActivityPage> {
  const pageSize = clampPageSize(f.pageSize)
  const days = clampPeriod(f.days)
  const and: Prisma.ApiRequestLogWhereInput[] = [{ timestamp: { gte: new Date(nowMs - days * DAY) } }]

  if (f.result === 'ok') and.push({ status: { lt: 400 } })
  else if (f.result === 'denied') and.push({ status: { in: [401, 403, 429] } })
  else if (f.result === 'error') and.push({ status: { gte: 400, notIn: [401, 403, 429] } })

  const q = typeof f.q === 'string' ? f.q.trim().slice(0, 100) : ''
  if (q) {
    const named = await prisma.user.findMany({ where: { name: { contains: q, mode: 'insensitive' } }, select: { email: true }, take: 50 })
    and.push({ apiKey: { OR: [{ ownerEmail: { contains: q, mode: 'insensitive' } }, { ownerEmail: { in: named.map((u) => u.email) } }, { name: { contains: q, mode: 'insensitive' } }] } })
  }
  const where: Prisma.ApiRequestLogWhereInput = { AND: and }

  const total = await prisma.apiRequestLog.count({ where })
  const p = paginate(Array.from({ length: total }), Number(f.page) || 1, pageSize)
  const rows = await prisma.apiRequestLog.findMany({ where, orderBy: { timestamp: 'desc' }, skip: (p.page - 1) * pageSize, take: pageSize, include: { apiKey: { select: { name: true, prefix: true, ownerEmail: true } } } })

  const users = await prisma.user.findMany({ where: { email: { in: [...new Set(rows.map((r) => r.apiKey.ownerEmail))] } }, select: { email: true, name: true, image: true } })
  const userMap = new Map(users.map((u) => [u.email, u]))

  return {
    rows: rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      ownerEmail: r.apiKey.ownerEmail,
      ownerName: userMap.get(r.apiKey.ownerEmail)?.name ?? null,
      ownerImage: userMap.get(r.apiKey.ownerEmail)?.image ?? null,
      tokenName: r.apiKey.name,
      tokenPrefix: r.apiKey.prefix,
      method: r.method,
      path: r.path,
      status: r.status,
      result: classifyStatus(r.status),
      ip: r.ip,
      userAgent: r.userAgent,
      durationMs: r.durationMs,
    })),
    page: p.page,
    pageCount: p.pageCount,
    total,
    from: p.from,
    to: p.to,
    pageSize,
  }
}
