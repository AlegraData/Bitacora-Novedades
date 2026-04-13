'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import type { Tag } from '@/types'

async function getSession() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  return user
}

export async function getTags(fieldId?: string): Promise<Tag[]> {
  const tags = await prisma.tag.findMany({
    where: fieldId ? { fieldId } : undefined,
    orderBy: { order: 'asc' },
  })
  return tags
}

export async function saveTag(data: {
  id?: string
  fieldId: string
  name: string
  color?: string
  order?: number
}): Promise<Tag> {
  await getSession()

  const existingCount = await prisma.tag.count({ where: { fieldId: data.fieldId } })
  const order = data.order ?? existingCount + 1

  const tag = data.id
    ? await prisma.tag.update({
        where: { id: data.id },
        data: { name: data.name, color: data.color ?? '#e2e8f0', order: data.order ?? undefined },
      })
    : await prisma.tag.create({
        data: {
          fieldId: data.fieldId,
          name: data.name,
          color: data.color ?? '#e2e8f0',
          order,
        },
      })

  revalidatePath('/app')
  return tag
}

export async function deleteTag(tagId: string): Promise<void> {
  await getSession()
  await prisma.tag.delete({ where: { id: tagId } })
  revalidatePath('/app')
}
