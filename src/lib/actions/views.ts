'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth-utils'
import type { View, FilterState, SortConfig } from '@/types'
import { Prisma } from '@/generated/prisma'

function toView(v: {
  id: string
  name: string
  emoji: string
  filters: unknown
  sort: unknown
  order: number
  createdAt: Date
  updatedAt: Date
}): View {
  return {
    id: v.id,
    name: v.name,
    emoji: v.emoji,
    filters: (v.filters ?? {}) as FilterState,
    sort: v.sort ? (v.sort as SortConfig) : null,
    order: v.order,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  }
}

export async function getViews(): Promise<View[]> {
  await requireUser()
  const views = await prisma.view.findMany({ orderBy: { order: 'asc' } })
  return views.map(toView)
}

export async function saveView(data: {
  id?: string
  name: string
  emoji: string
  filters: FilterState
  sort: SortConfig | null
  order?: number
}): Promise<View> {
  await requireUser()

  const filtersJson = data.filters as unknown as Prisma.InputJsonValue
  const sortJson = data.sort ? (data.sort as unknown as Prisma.InputJsonValue) : Prisma.DbNull

  let view
  if (data.id) {
    view = await prisma.view.update({
      where: { id: data.id },
      data: {
        name: data.name,
        emoji: data.emoji,
        filters: filtersJson,
        sort: sortJson,
      },
    })
  } else {
    const count = await prisma.view.count()
    view = await prisma.view.create({
      data: {
        name: data.name,
        emoji: data.emoji,
        filters: filtersJson,
        sort: sortJson,
        order: data.order ?? count,
      },
    })
  }

  revalidatePath('/app')
  return toView(view)
}

export async function deleteView(id: string): Promise<void> {
  await requireUser()
  await prisma.view.delete({ where: { id } })
  revalidatePath('/app')
}
