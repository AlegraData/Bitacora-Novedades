'use server'

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma'
import type { AuditLog } from '@/types'

export async function addAuditLog(data: {
  userId?: string | null
  userEmail: string
  userName: string
  action: string
  recordId?: string | null
  details?: Record<string, unknown> | null
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: data.userId,
      userEmail: data.userEmail,
      userName: data.userName,
      action: data.action,
      recordId: data.recordId,
      details: data.details as unknown as Prisma.InputJsonValue ?? undefined,
    },
  })
}

export async function getAuditLogs(limit = 50): Promise<AuditLog[]> {
  const logs = await prisma.auditLog.findMany({
    orderBy: { timestamp: 'desc' },
    take: limit,
  })
  return logs.map((log) => ({
    id: log.id,
    timestamp: log.timestamp.toISOString(),
    userId: log.userId,
    userEmail: log.userEmail,
    userName: log.userName,
    action: log.action,
    recordId: log.recordId,
    details: log.details as Record<string, unknown> | null,
  }))
}
