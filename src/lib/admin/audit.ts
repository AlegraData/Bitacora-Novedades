import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma'
import { clampPageSize, paginate, type PageSize } from './table'

// Consulta paginada del audit log para el panel de administración (la paginación se hace en la base,
// no en el navegador: el log crece sin parar).

export interface AuditFilters {
  q?: unknown
  action?: unknown
  /** Filtro de origen: mcp | api (sale de details.via). Lo que no lo trae es la app web. */
  via?: unknown
  page?: unknown
  pageSize?: unknown
}

export interface AuditRowDTO {
  id: string
  timestamp: string
  userEmail: string
  userName: string
  action: string
  recordId: string | null
  /** web | mcp | api */
  via: string
  tool: string | null
  details: Record<string, unknown> | null
}

export interface AuditPageDTO {
  rows: AuditRowDTO[]
  page: number
  pageCount: number
  total: number
  from: number
  to: number
  pageSize: PageSize
  /** Acciones que existen en el log (para el filtro). */
  actions: string[]
}

const VIAS = ['mcp', 'api'] as const

function viaOf(details: unknown): string {
  const v = (details as { via?: unknown } | null)?.via
  return typeof v === 'string' && v ? v : 'web'
}

export async function queryAuditLogs(f: AuditFilters = {}): Promise<AuditPageDTO> {
  const pageSize = clampPageSize(f.pageSize)
  const q = typeof f.q === 'string' ? f.q.trim().slice(0, 100) : ''
  const where: Prisma.AuditLogWhereInput = {}
  const and: Prisma.AuditLogWhereInput[] = []

  if (q) {
    // Cada palabra debe aparecer en el usuario, el correo, la acción o el ID del registro.
    for (const w of q.split(/\s+/).filter(Boolean).slice(0, 5)) {
      and.push({ OR: [
        { userName: { contains: w, mode: 'insensitive' } },
        { userEmail: { contains: w, mode: 'insensitive' } },
        { action: { contains: w, mode: 'insensitive' } },
        { recordId: { contains: w, mode: 'insensitive' } },
      ] })
    }
  }
  if (typeof f.action === 'string' && f.action) where.action = f.action
  if (typeof f.via === 'string' && (VIAS as readonly string[]).includes(f.via)) {
    and.push({ details: { path: ['via'], equals: f.via } })
  }
  if (and.length) where.AND = and

  const [total, actions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
  ])
  const p = paginate(Array.from({ length: total }), Number(f.page) || 1, pageSize) // solo para ajustar página y rangos
  const rows = await prisma.auditLog.findMany({ where, orderBy: { timestamp: 'desc' }, skip: (p.page - 1) * pageSize, take: pageSize })

  return {
    rows: rows.map((r) => {
      const details = (r.details as Record<string, unknown> | null) ?? null
      return {
        id: r.id,
        timestamp: r.timestamp.toISOString(),
        userEmail: r.userEmail,
        userName: r.userName,
        action: r.action,
        recordId: r.recordId,
        via: viaOf(details),
        tool: typeof details?.tool === 'string' ? details.tool : null,
        details,
      }
    }),
    page: p.page,
    pageCount: p.pageCount,
    total,
    from: p.from,
    to: p.to,
    pageSize,
    actions: actions.map((a) => a.action),
  }
}
