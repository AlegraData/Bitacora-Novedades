'use server'

import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-utils'
import { getFields } from './fields'
import type { Field } from '@/types'

/**
 * Configura los campos de persona correctamente:
 *  - Elaborado  → person, multiple: false (una persona)
 *  - Responsables → person, multiple: true (varias personas, con buscador)
 * Retorna todos los campos actualizados para refrescar el estado del cliente.
 */
export async function setupPersonFields(): Promise<{ fields: Field[]; updated: string[] }> {
  await requireAdmin()

  const updated: string[] = []

  // ── Elaborado: person, única persona ─────────────────────────────────────
  const elaborado = await prisma.field.findFirst({
    where: { name: { equals: 'Elaborado', mode: 'insensitive' } },
  })
  if (elaborado) {
    await prisma.field.update({
      where: { id: elaborado.id },
      data: { type: 'person', config: { multiple: false } },
    })
    updated.push(elaborado.name)
  }

  // ── Responsables: person, múltiples personas ──────────────────────────────
  const responsables = await prisma.field.findFirst({
    where: { name: { equals: 'Responsables', mode: 'insensitive' } },
  })
  if (responsables) {
    await prisma.field.update({
      where: { id: responsables.id },
      data: { type: 'person', config: { multiple: true } },
    })
    // Garantizar que ADMIN y MANAGER pueden editar
    for (const role of ['ADMIN', 'MANAGER'] as const) {
      await prisma.fieldPermission.upsert({
        where: { fieldId_role: { fieldId: responsables.id, role } },
        update: { canEdit: true },
        create: { fieldId: responsables.id, role, canEdit: true },
      })
    }
    updated.push(responsables.name)
  }

  // Devolver todos los campos con los datos frescos
  const fields = await getFields()
  return { fields, updated }
}
