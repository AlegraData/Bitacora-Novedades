'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-utils'

export interface McpSession {
  id: string
  userEmail: string
  userName: string | null
  userImage: string | null
  clientName: string | null
  expiresAt: string
  refreshExpiresAt: string
  lastUsedAt: string | null
  createdAt: string
}

export async function getActiveMcpSessions(): Promise<McpSession[]> {
  await requireAdmin()

  const sessions = await prisma.oAuthSession.findMany({
    where: { revokedAt: null },
    orderBy: { createdAt: 'desc' },
  })

  const emails = Array.from(new Set(sessions.map((s) => s.userEmail)))
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true, name: true, image: true },
  })
  const userMap = new Map(users.map((u) => [u.email, u]))

  return sessions.map((s) => {
    const user = userMap.get(s.userEmail)
    return {
      id: s.id,
      userEmail: s.userEmail,
      userName: user?.name ?? null,
      userImage: user?.image ?? null,
      clientName: s.clientName,
      expiresAt: s.expiresAt.toISOString(),
      refreshExpiresAt: s.refreshExpiresAt.toISOString(),
      lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    }
  })
}

export async function revokeMcpSession(sessionId: string): Promise<void> {
  await requireAdmin()
  await prisma.oAuthSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  })
  revalidatePath('/admin')
}
