import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma'
import { LOGICAL_FIELD_NAMES } from '@/lib/field-names'

// Preparación de datos para TMDIAPD-56 (se corre una vez, primero en simulacro): crear el campo
// «¿Trae video?» (selector Sí/No) y unificar «Pre novedad» con «Pre-novedad».

const TRAE_VIDEO = LOGICAL_FIELD_NAMES.traeVideo
const OPTIONS = ['Sí', 'No']

export interface TraeVideoReport {
  existed: boolean
  created: boolean
  addedOptions: string[]
  fieldId?: string
}

export async function ensureTraeVideoField(opts: { apply: boolean }): Promise<TraeVideoReport> {
  const existing = await prisma.field.findFirst({ where: { name: TRAE_VIDEO }, include: { options: true } })
  if (existing) {
    const have = new Set(existing.options.map((o) => o.name))
    const missing = OPTIONS.filter((o) => !have.has(o))
    if (opts.apply && missing.length) {
      await prisma.tag.createMany({ data: missing.map((name, i) => ({ fieldId: existing.id, name, order: existing.options.length + i })) })
    }
    return { existed: true, created: false, addedOptions: missing, fieldId: existing.id }
  }

  if (!opts.apply) return { existed: false, created: false, addedOptions: OPTIONS }

  // Se coloca justo después de «Video»: se corre una posición lo que venga después.
  const video = await prisma.field.findFirst({ where: { name: LOGICAL_FIELD_NAMES.video } })
  const order = video ? video.order + 1 : (await prisma.field.count()) + 1
  const created = await prisma.$transaction(async (tx) => {
    if (video) await tx.field.updateMany({ where: { order: { gt: video.order } }, data: { order: { increment: 1 } } })
    return tx.field.create({
      data: {
        name: TRAE_VIDEO,
        type: 'select',
        order,
        isFilterable: true,
        isVisible: true,
        options: { create: OPTIONS.map((name, i) => ({ name, order: i })) },
      },
    })
  })
  return { existed: false, created: true, addedOptions: OPTIONS, fieldId: created.id }
}

const norm = (s: string) => s.toLowerCase().replace(/[-_\s]+/g, ' ').trim()

export interface UnifyReport {
  tipoField: boolean
  /** Todas las opciones del campo Tipo (para confirmar los nombres de los tipos). */
  options: string[]
  variants: string[]
  canonical: string | null
  recordsToUpdate: number
  updated: number
  removedOptions: number
}

export async function unifyPreNovedad(opts: { apply: boolean }): Promise<UnifyReport> {
  const tipo = await prisma.field.findFirst({ where: { name: LOGICAL_FIELD_NAMES.tipo }, include: { options: { orderBy: { order: 'asc' } } } })
  if (!tipo) return { tipoField: false, options: [], variants: [], canonical: null, recordsToUpdate: 0, updated: 0, removedOptions: 0 }

  const options = tipo.options.map((o) => o.name)
  const variants = tipo.options.filter((o) => norm(o.name) === 'pre novedad')
  const base: UnifyReport = { tipoField: true, options, variants: variants.map((v) => v.name), canonical: null, recordsToUpdate: 0, updated: 0, removedOptions: 0 }
  if (variants.length < 2) return { ...base, canonical: variants[0]?.name ?? null }

  const canonical = variants.find((v) => v.name === 'Pre-novedad') ?? variants[0]
  const others = variants.filter((v) => v.id !== canonical.id)
  const otherNames = new Set(others.map((o) => o.name))

  const records = await prisma.record.findMany({ select: { id: true, data: true } })
  const affected = records.filter((r) => otherNames.has(String((r.data as Record<string, unknown>)[tipo.id] ?? '')))
  const report = { ...base, canonical: canonical.name, recordsToUpdate: affected.length }
  if (!opts.apply) return report

  let updated = 0
  for (const r of affected) {
    const data = { ...(r.data as Record<string, unknown>), [tipo.id]: canonical.name }
    await prisma.record.update({ where: { id: r.id }, data: { data: data as Prisma.InputJsonValue } })
    updated++
  }
  const removed = await prisma.tag.deleteMany({ where: { id: { in: others.map((o) => o.id) } } })
  return { ...report, updated, removedOptions: removed.count }
}
