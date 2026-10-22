import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma'
import type { Role } from '@/types'

export const DELIVERY_STATUSES = ['sending', 'sent', 'failed', 'simulated'] as const
export const DELIVERY_MODES_FILTER = ['webhook', 'shadow', 'test', 'live', 'simulate', 'legacy'] as const

export interface DeliveryDTO {
  id: string
  recordId: string | null
  mode: string
  status: string
  subject: string | null
  recipients: string[]
  rejected: string[]
  channel: string
  trigger: string
  triggeredByEmail: string
  triggeredByName: string | null
  resendReason: string | null
  errorCode: string | null
  errorMessage: string | null
  chatStatus: string | null
  createdAt: string
  finishedAt: string | null
  durationMs: number | null
  // Solo ADMIN:
  errorDetail?: string | null
  messageId?: string | null
  chatError?: string | null
  legacyResponse?: string | null
  html?: string | null
}

type Row = Awaited<ReturnType<typeof prisma.emailDelivery.findFirstOrThrow>>

export function toDeliveryDTO(r: Row, role: Role, includeHtml = false): DeliveryDTO {
  const dto: DeliveryDTO = {
    id: r.id,
    recordId: r.recordId,
    mode: r.mode,
    status: r.status,
    subject: r.subject,
    recipients: r.recipients,
    rejected: r.rejected,
    channel: r.channel,
    trigger: r.trigger,
    triggeredByEmail: r.triggeredByEmail,
    triggeredByName: r.triggeredByName,
    resendReason: r.resendReason,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    chatStatus: r.chatStatus,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    durationMs: r.durationMs,
  }
  if (role === 'ADMIN') {
    dto.errorDetail = r.errorDetail
    dto.messageId = r.messageId
    dto.chatError = r.chatError
    dto.legacyResponse = r.legacyResponse
    if (includeHtml) dto.html = r.html
  }
  return dto
}

export interface DeliveryFilters {
  recordId?: unknown
  status?: unknown
  mode?: unknown
  limit?: unknown
  offset?: unknown
}

export async function listDeliveries(role: Role, f: DeliveryFilters = {}): Promise<{ total: number; limit: number; offset: number; deliveries: DeliveryDTO[] }> {
  const where: Prisma.EmailDeliveryWhereInput = {}
  if (typeof f.recordId === 'string' && f.recordId) where.recordId = f.recordId
  if (typeof f.status === 'string' && (DELIVERY_STATUSES as readonly string[]).includes(f.status)) where.status = f.status
  if (typeof f.mode === 'string' && (DELIVERY_MODES_FILTER as readonly string[]).includes(f.mode)) where.mode = f.mode
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 200)
  const offset = Math.max(Number(f.offset) || 0, 0)

  const [total, rows] = await Promise.all([
    prisma.emailDelivery.count({ where }),
    prisma.emailDelivery.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
  ])
  return { total, limit, offset, deliveries: rows.map((r) => toDeliveryDTO(r, role)) }
}

export async function getDelivery(role: Role, id: string, includeHtml = false): Promise<DeliveryDTO | null> {
  const r = await prisma.emailDelivery.findUnique({ where: { id } })
  return r ? toDeliveryDTO(r, role, includeHtml) : null
}
