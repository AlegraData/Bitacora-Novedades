import { prisma } from '@/lib/prisma'

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ApiRequestLog", "ApiKey", "AuditLog", "RecordEmbedding", "Record", "User" RESTART IDENTITY CASCADE'
  ).catch(async () => {
    // Antes de que existan las tablas de API (commits iniciales).
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "AuditLog", "RecordEmbedding", "Record", "User" RESTART IDENTITY CASCADE')
  })
}

export async function makeUser(email: string, role: 'ADMIN' | 'MANAGER' | 'VIEWER' = 'VIEWER') {
  return prisma.user.upsert({
    where: { email },
    update: { role },
    create: { email, name: email.split('@')[0], role },
  })
}
