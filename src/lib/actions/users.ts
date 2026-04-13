'use server'

import { prisma } from '@/lib/prisma'
import { requireAdmin, requireUser } from '@/lib/auth-utils'
import type { Role } from '@/types'

export async function getCurrentUserProfile() {
  try {
    return await requireUser()
  } catch (error) {
    return null
  }
}

export async function getAllUsers() {
  await requireAdmin()
  return prisma.user.findMany({ orderBy: { name: 'asc' } })
}

export async function updateUserRole(userId: string, role: Role): Promise<void> {
  await requireAdmin()
  await prisma.user.update({ where: { id: userId }, data: { role } })
}
