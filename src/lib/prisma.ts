import { Pool } from 'pg'
import { PrismaClient } from '../generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL ?? ''

  // El pooler compartido de Supabase a veces entrega una conexión con un
  // "timezone" de sesión distinto de UTC (visto en producción: timestamps
  // guardados ~5h adelantados). Se fuerza UTC explícitamente en cada
  // conexión nueva del pool para no depender del estado que traiga el pooler.
  const pool = new Pool({ connectionString })
  pool.on('connect', (client) => {
    client.query("SET TIME ZONE 'UTC'").catch((err) => {
      console.error('No se pudo forzar timezone UTC en la conexión de Postgres:', err)
    })
  })

  const adapter = new PrismaPg(pool)
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
