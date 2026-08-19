import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Role } from '@/types'

export interface Caller {
  id: string
  email: string
  name: string | null
  role: Role
}

export async function resolveCaller(request: NextRequest): Promise<Caller | null> {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const session = await prisma.oAuthSession.findUnique({ where: { accessToken: token } })
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null

  let user = await prisma.user.findUnique({ where: { email: session.userEmail } })
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: session.userEmail,
        name: session.userEmail.split('@')[0],
        role: 'VIEWER',
      },
    })
  }

  prisma.oAuthSession
    .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {})

  return { id: user.id, email: user.email, name: user.name, role: user.role as Role }
}
