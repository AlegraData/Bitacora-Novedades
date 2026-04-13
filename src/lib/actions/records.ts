'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import type { BitacoraRecord, RecordData, FilterState } from '@/types'
import { addAuditLog } from './audit'

async function getCurrentUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')

  const dbUser = await prisma.user.findUnique({ where: { email: user.email! } })
  return {
    id: dbUser?.id ?? null,
    email: user.email!,
    name: dbUser?.name ?? user.user_metadata?.full_name ?? user.email!.split('@')[0],
    role: dbUser?.role ?? 'VIEWER',
  }
}

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
  const raw = await prisma.record.findMany({ orderBy: { createdAt: 'desc' } })
  let records = raw.map(toRecord)

  if (!filters) return records

  if (filters.search) {
    const q = filters.search.toLowerCase()
    records = records.filter((r) =>
      Object.values(r.data).some((v) => String(v ?? '').toLowerCase().includes(q))
    )
  }

  if (filters.fieldId && filters.value !== undefined && filters.value !== '') {
    records = records.filter((r) => {
      const val = String(r.data[filters.fieldId!] ?? '')
      return val.toLowerCase().includes(filters.value!.toLowerCase())
    })
  }

  if (filters.dateFrom && filters.dateTo && filters.dateFieldId) {
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
  const r = await prisma.record.findUnique({ where: { id } })
  return r ? toRecord(r) : null
}

export async function saveRecord(data: {
  id?: string
  recordData: RecordData
}): Promise<BitacoraRecord> {
  const user = await getCurrentUser()
  const isNew = !data.id

  const record = isNew
    ? await prisma.record.create({
        data: {
          data: data.recordData,
          createdByEmail: user.email,
          createdByName: user.name,
        },
      })
    : await prisma.record.update({
        where: { id: data.id },
        data: { data: data.recordData },
      })

  await addAuditLog({
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    action: isNew ? 'CREATED_RECORD' : 'UPDATED_RECORD',
    recordId: record.id,
  })

  revalidatePath('/app')
  return toRecord(record)
}

export async function deleteRecord(recordId: string): Promise<void> {
  const user = await getCurrentUser()
  await prisma.record.delete({ where: { id: recordId } })
  await addAuditLog({
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    action: 'DELETED_RECORD',
    recordId,
  })
  revalidatePath('/app')
}
