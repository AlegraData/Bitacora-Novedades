'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-utils'
import type { Field, Role } from '@/types'
import type { Prisma } from '@/generated/prisma'

const fieldInclude = {
  options: { orderBy: { order: 'asc' as const } },
  permissions: true,
} satisfies Prisma.FieldInclude

type FieldWithRelations = Prisma.FieldGetPayload<{ include: typeof fieldInclude }>

function toField(f: FieldWithRelations): Field {
  return {
    id: f.id,
    name: f.name,
    type: f.type as Field['type'],
    order: f.order,
    isFilterable: f.isFilterable,
    isVisible: f.isVisible,
    config: f.config as Field['config'],
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    options: f.options.map((t) => ({ ...t })),
    permissions: f.permissions.map((p) => ({ ...p, role: p.role as Role })),
  }
}

export async function getFields(): Promise<Field[]> {
  const fields = await prisma.field.findMany({
    include: fieldInclude,
    orderBy: { order: 'asc' },
  })
  return fields.map(toField)
}

export async function saveField(data: {
  id?: string
  name: string
  type: string
  isFilterable?: boolean
  isVisible?: boolean
  config?: Record<string, unknown> | null
  order?: number
}): Promise<Field> {
  await requireAdmin()

  const existingCount = await prisma.field.count()
  const order = data.order ?? existingCount + 1
  const config = data.config as Prisma.InputJsonValue | undefined

  let field: FieldWithRelations
  if (data.id) {
    field = await prisma.field.update({
      where: { id: data.id },
      data: {
        name: data.name,
        type: data.type,
        isFilterable: data.isFilterable ?? true,
        isVisible: data.isVisible ?? true,
        config: config ?? undefined,
        order: data.order ?? undefined,
      },
      include: fieldInclude,
    })
  } else {
    field = await prisma.field.create({
      data: {
        name: data.name,
        type: data.type,
        isFilterable: data.isFilterable ?? true,
        isVisible: data.isVisible ?? true,
        config: config ?? undefined,
        order,
      },
      include: fieldInclude,
    })
  }

  revalidatePath('/app')
  return toField(field)
}

export async function deleteField(fieldId: string): Promise<void> {
  await requireAdmin()
  await prisma.field.delete({ where: { id: fieldId } })
  revalidatePath('/app')
}

export async function reorderFields(orderedIds: string[]): Promise<void> {
  await requireAdmin()
  await Promise.all(
    orderedIds.map((id, index) =>
      prisma.field.update({ where: { id }, data: { order: index + 1 } })
    )
  )
  revalidatePath('/app')
}

export async function saveFieldPermission(
  fieldId: string,
  role: Role,
  canEdit: boolean
): Promise<void> {
  await requireAdmin()
  await prisma.fieldPermission.upsert({
    where: { fieldId_role: { fieldId, role } },
    update: { canEdit },
    create: { fieldId, role, canEdit },
  })
  revalidatePath('/app')
  revalidatePath('/admin')
}
