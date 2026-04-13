'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireUser, requireManager, requireAdmin } from '@/lib/auth-utils'
import type { BitacoraRecord, RecordData, FilterState } from '@/types'
import { addAuditLog } from './audit'
import { updateRecordEmbedding } from './ai'
import type { Prisma } from '@/generated/prisma'

function toRecord(r: {
  id: string
  data: unknown
  createdAt: Date
  updatedAt: Date
  createdByEmail: string
  createdByName: string
}): BitacoraRecord {
  return {
    id: r.id,
    data: r.data as RecordData,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdByEmail: r.createdByEmail,
    createdByName: r.createdByName,
  }
}

export async function getRecords(filters?: Partial<FilterState>): Promise<BitacoraRecord[]> {
  await requireUser()

  const where: Prisma.RecordWhereInput = {}

  if (filters?.fieldId && filters.value !== undefined && filters.value !== '') {
    // Filtrado nativo de JSONB en PostgreSQL vía Prisma
    where.data = {
      path: [filters.fieldId],
      string_contains: filters.value,
    }
  }

  // Nota: El filtrado global 'search' en todas las llaves del JSONB 
  // es complejo en Prisma sin raw SQL. Por ahora optimizamos el filtrado por campo.
  
  const raw = await prisma.record.findMany({ 
    where,
    orderBy: { createdAt: 'desc' } 
  })
  
  let records = raw.map(toRecord)

  // Filtros adicionales que aún requieren procesamiento en memoria o lógica compleja
  if (filters?.search) {
    const q = filters.search.toLowerCase()
    records = records.filter((r) =>
      Object.values(r.data).some((v) => String(v ?? '').toLowerCase().includes(q))
    )
  }

  if (filters?.dateFrom && filters?.dateTo && filters?.dateFieldId) {
    const from = new Date(filters.dateFrom)
    const to = new Date(filters.dateTo)
    records = records.filter((r) => {
      const d = new Date(String(r.data[filters.dateFieldId!] ?? ''))
      return !isNaN(d.getTime()) && d >= from && d <= to
    })
  }

  return records
}

export async function getRecord(id: string): Promise<BitacoraRecord | null> {
  await requireUser()
  const r = await prisma.record.findUnique({ where: { id } })
  return r ? toRecord(r) : null
}

export async function saveRecord(data: {
  id?: string
  recordData: RecordData
}): Promise<BitacoraRecord> {
  const user = await requireManager()
  const isNew = !data.id

  const jsonData = data.recordData as unknown as Prisma.InputJsonValue

  const record = isNew
    ? await prisma.record.create({
        data: {
          data: jsonData,
          createdByEmail: user.email,
          createdByName: user.name ?? user.email,
        },
      })
    : await prisma.record.update({
        where: { id: data.id },
        data: { data: jsonData },
      })

  await addAuditLog({
    userId: user.id,
    userEmail: user.email,
    userName: user.name ?? user.email,
    action: isNew ? 'CREATED_RECORD' : 'UPDATED_RECORD',
    recordId: record.id,
  })

  // Generar embedding en segundo plano
  try {
    await updateRecordEmbedding(record.id, record.data as Record<string, unknown>)
  } catch (error) {
    console.error('Error al generar embedding:', error)
  }

  revalidatePath('/app')
  return toRecord(record)
}

export async function deleteRecord(recordId: string): Promise<void> {
  const user = await requireAdmin()
  await prisma.record.delete({ where: { id: recordId } })
  await addAuditLog({
    userId: user.id,
    userEmail: user.email,
    userName: user.name ?? user.email,
    action: 'DELETED_RECORD',
    recordId,
  })
  revalidatePath('/app')
}
