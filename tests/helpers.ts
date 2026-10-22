import { prisma } from '@/lib/prisma'
import { LOGICAL_FIELD_NAMES } from '@/lib/mcp/fields'

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "EmailDelivery", "EmailTemplateRevision", "EmailTemplate", "EmailSettings", "ApiRequestLog", "ApiKey", "AuditLog", "RecordEmbedding", "Record", "User" RESTART IDENTITY CASCADE'
  )
}

export async function makeUser(email: string, role: 'ADMIN' | 'MANAGER' | 'VIEWER' = 'VIEWER') {
  return prisma.user.upsert({
    where: { email },
    update: { role },
    create: { email, name: email.split('@')[0], role },
  })
}

const FIELD_TYPES: Record<string, { type: string; options?: string[] }> = {
  tipo: { type: 'select', options: ['Novedad', 'Pre-novedad', 'Mejora'] },
  elaborado: { type: 'person' },
  responsables: { type: 'person' },
  producto: { type: 'multiselect', options: ['Alegra Contabilidad', 'Alegra POS', 'Alegra Nómina'] },
  version: { type: 'multiselect' },
  correosAComunicar: { type: 'multiselect' },
  fechaLanzamiento: { type: 'date' },
  fechaFinEarlyAdopters: { type: 'date' },
  fechaProduccion: { type: 'date' },
}

/** Crea (una sola vez) los Field que usa el mapa lógico del MCP. No se trunca entre tests. */
export async function ensureFields() {
  if ((await prisma.field.count()) > 0) return
  let order = 0
  for (const [key, name] of Object.entries(LOGICAL_FIELD_NAMES)) {
    const def = FIELD_TYPES[key] ?? { type: 'text' }
    await prisma.field.create({
      data: {
        name,
        type: def.type,
        order: order++,
        options: { create: (def.options ?? []).map((n, i) => ({ name: n, order: i })) },
      },
    })
  }
}
