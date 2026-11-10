import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma'
import { loadFieldMap, mapRecordData } from '@/lib/mcp/fields'
import { AGENTS, agentOf, type Agent } from './agents'
import { clampPageSize, paginate, type PageSize } from './table'

// Datos del dashboard «Conexiones MCP»: quién se conectó, con qué agente, qué consultó y cómo terminó.
// Solo se guarda qué herramienta se usó y sobre qué registro, nunca el contenido.

export const PERIODS = [7, 30, 90] as const
export type Period = (typeof PERIODS)[number]

export function clampPeriod(n: unknown): Period {
  return (PERIODS as readonly number[]).includes(Number(n)) ? (Number(n) as Period) : 7
}

const DAY = 86_400_000
const TZ = 'America/Bogota'

/** Día (YYYY-MM-DD) en hora de Colombia, para agrupar «llamadas por día». */
export function dayKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}

export interface ConnectionDTO {
  id: string
  agent: Agent
  clientName: string | null
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string
  calls: number
  status: 'active' | 'expiring' | 'expired' | 'revoked'
}

export interface PersonDTO {
  email: string
  name: string | null
  image: string | null
  agents: { agent: Agent; count: number }[]
  /** Conexiones vigentes. */
  activeConnections: number
  lastUsedAt: string | null
  calls: number
  connections: ConnectionDTO[]
}

export interface McpOverviewDTO {
  period: Period
  /** Desde cuándo hay registro detallado de llamadas (null si todavía no hay ninguna). */
  trackingSince: string | null
  people: number
  activeConnections: number
  calls: number
  results: { ok: number; denied: number; error: number }
  byAgent: { agent: Agent; count: number }[]
  perDay: { date: string; label: string; value: number }[]
  rows: PersonDTO[]
}

function connectionStatus(s: { revokedAt: Date | null; refreshExpiresAt: Date }, now: number): ConnectionDTO['status'] {
  if (s.revokedAt) return 'revoked'
  const left = s.refreshExpiresAt.getTime() - now
  if (left <= 0) return 'expired'
  return left < DAY ? 'expiring' : 'active'
}

export async function getMcpOverview(periodInput: unknown = 7, nowMs = Date.now()): Promise<McpOverviewDTO> {
  const period = clampPeriod(periodInput)
  const since = new Date(nowMs - period * DAY)

  const [sessions, calls, first] = await Promise.all([
    // Conexiones vigentes y las que terminaron en los últimos 90 días (para «incluir personas sin conexión vigente»).
    prisma.oAuthSession.findMany({
      where: { OR: [{ revokedAt: null, refreshExpiresAt: { gt: new Date(nowMs) } }, { createdAt: { gte: new Date(nowMs - 90 * DAY) } }] },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.mcpToolCall.findMany({ where: { timestamp: { gte: since } }, select: { timestamp: true, status: true, userEmail: true, sessionId: true } }),
    prisma.mcpToolCall.findFirst({ orderBy: { timestamp: 'asc' }, select: { timestamp: true } }),
  ])

  const emails = [...new Set(sessions.map((s) => s.userEmail))]
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true, name: true, image: true } })
  const userMap = new Map(users.map((u) => [u.email, u]))

  const callsBySession = new Map<string, number>()
  const callsByUser = new Map<string, number>()
  const results = { ok: 0, denied: 0, error: 0 }
  const perDayMap = new Map<string, number>()
  for (const c of calls) {
    if (c.sessionId) callsBySession.set(c.sessionId, (callsBySession.get(c.sessionId) ?? 0) + 1)
    callsByUser.set(c.userEmail, (callsByUser.get(c.userEmail) ?? 0) + 1)
    if (c.status === 'ok' || c.status === 'denied' || c.status === 'error') results[c.status]++
    const k = dayKey(c.timestamp)
    perDayMap.set(k, (perDayMap.get(k) ?? 0) + 1)
  }

  const perDay: McpOverviewDTO['perDay'] = []
  for (let i = period - 1; i >= 0; i--) {
    const d = new Date(nowMs - i * DAY)
    const k = dayKey(d)
    const [, m, day] = k.split('-')
    perDay.push({ date: k, label: `${Number(day)}/${Number(m)}`, value: perDayMap.get(k) ?? 0 })
  }

  const byPerson = new Map<string, PersonDTO>()
  for (const s of sessions) {
    const status = connectionStatus(s, nowMs)
    const agent = agentOf(s.clientName)
    const u = userMap.get(s.userEmail)
    const p = byPerson.get(s.userEmail) ?? { email: s.userEmail, name: u?.name ?? null, image: u?.image ?? null, agents: [], activeConnections: 0, lastUsedAt: null, calls: callsByUser.get(s.userEmail) ?? 0, connections: [] }
    p.connections.push({
      id: s.id, agent, clientName: s.clientName, createdAt: s.createdAt.toISOString(), lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
      expiresAt: s.refreshExpiresAt.toISOString(), calls: callsBySession.get(s.id) ?? 0, status,
    })
    if (status === 'active' || status === 'expiring') p.activeConnections++
    if (s.lastUsedAt && (!p.lastUsedAt || s.lastUsedAt.toISOString() > p.lastUsedAt)) p.lastUsedAt = s.lastUsedAt.toISOString()
    byPerson.set(s.userEmail, p)
  }
  const rows = [...byPerson.values()].map((p) => {
    const counts = new Map<Agent, number>()
    for (const c of p.connections) if (c.status === 'active' || c.status === 'expiring') counts.set(c.agent, (counts.get(c.agent) ?? 0) + 1)
    return { ...p, agents: [...counts.entries()].map(([agent, count]) => ({ agent, count })) }
  })
  // Más reciente primero; las personas sin uso, al final.
  rows.sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') || a.email.localeCompare(b.email))

  const agentCounts = new Map<Agent, number>()
  for (const p of rows) for (const a of p.agents) agentCounts.set(a.agent, (agentCounts.get(a.agent) ?? 0) + a.count)

  return {
    period,
    trackingSince: first?.timestamp.toISOString() ?? null,
    people: rows.filter((p) => p.activeConnections > 0).length,
    activeConnections: rows.reduce((n, p) => n + p.activeConnections, 0),
    calls: calls.length,
    results,
    byAgent: AGENTS.map((agent) => ({ agent, count: agentCounts.get(agent) ?? 0 })).filter((a) => a.count > 0),
    perDay,
    rows,
  }
}

// ---------- actividad (consultas), paginada en el servidor ----------

export interface McpActivityFilters {
  q?: unknown
  status?: unknown
  tool?: unknown
  days?: unknown
  page?: unknown
  pageSize?: unknown
}

export interface McpActivityRow {
  id: string
  timestamp: string
  userEmail: string
  userName: string | null
  userImage: string | null
  agent: string
  tool: string
  recordId: string | null
  recordTitle: string | null
  status: string
  errorMessage: string | null
  durationMs: number
}

export interface McpActivityPage {
  rows: McpActivityRow[]
  page: number
  pageCount: number
  total: number
  from: number
  to: number
  pageSize: PageSize
  tools: string[]
}

const STATUSES = ['ok', 'denied', 'error']

export async function getMcpActivity(f: McpActivityFilters = {}, nowMs = Date.now()): Promise<McpActivityPage> {
  const pageSize = clampPageSize(f.pageSize)
  const days = clampPeriod(f.days)
  const where: Prisma.McpToolCallWhereInput = { timestamp: { gte: new Date(nowMs - days * DAY) } }
  if (typeof f.status === 'string' && STATUSES.includes(f.status)) where.status = f.status
  if (typeof f.tool === 'string' && f.tool) where.tool = f.tool

  const q = typeof f.q === 'string' ? f.q.trim().slice(0, 100) : ''
  if (q) {
    const named = await prisma.user.findMany({ where: { name: { contains: q, mode: 'insensitive' } }, select: { email: true }, take: 50 })
    where.OR = [{ userEmail: { contains: q, mode: 'insensitive' } }, { userEmail: { in: named.map((u) => u.email) } }]
  }

  const [total, tools] = await Promise.all([
    prisma.mcpToolCall.count({ where }),
    prisma.mcpToolCall.findMany({ distinct: ['tool'], select: { tool: true }, orderBy: { tool: 'asc' } }),
  ])
  const p = paginate(Array.from({ length: total }), Number(f.page) || 1, pageSize)
  const rows = await prisma.mcpToolCall.findMany({ where, orderBy: { timestamp: 'desc' }, skip: (p.page - 1) * pageSize, take: pageSize })

  const emails = [...new Set(rows.map((r) => r.userEmail))]
  const ids = [...new Set(rows.map((r) => r.recordId).filter((v): v is string => !!v))]
  const [users, records, map] = await Promise.all([
    prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true, name: true, image: true } }),
    ids.length ? prisma.record.findMany({ where: { id: { in: ids } }, select: { id: true, data: true } }) : Promise.resolve([]),
    ids.length ? loadFieldMap() : Promise.resolve(null),
  ])
  const userMap = new Map(users.map((u) => [u.email, u]))
  const titles = new Map<string, string>()
  if (map) for (const r of records) titles.set(r.id, String(mapRecordData(r.data as Record<string, unknown>, map).titulo ?? '').trim())

  return {
    rows: rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      userEmail: r.userEmail,
      userName: userMap.get(r.userEmail)?.name ?? null,
      userImage: userMap.get(r.userEmail)?.image ?? null,
      agent: r.agent,
      tool: r.tool,
      recordId: r.recordId,
      recordTitle: r.recordId ? titles.get(r.recordId) || null : null,
      status: r.status,
      errorMessage: r.errorMessage,
      durationMs: r.durationMs,
    })),
    page: p.page,
    pageCount: p.pageCount,
    total,
    from: p.from,
    to: p.to,
    pageSize,
    tools: tools.map((t) => t.tool),
  }
}
