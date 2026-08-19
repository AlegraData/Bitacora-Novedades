import { prisma } from '@/lib/prisma'

/**
 * La Bitácora guarda los campos como filas dinámicas de `Field` (no columnas
 * fijas). Este mapa traduce los nombres lógicos que usa el spec del MCP a los
 * nombres reales de `Field.name` en producción.
 */
export const LOGICAL_FIELD_NAMES: Record<string, string> = {
  tipo: 'Tipo',
  titulo: 'Título',
  fechaLanzamiento: 'Fecha de lanzamiento',
  fechaFinEarlyAdopters: 'Fecha Fin Early Adopters',
  elaborado: 'Elaborado',
  responsables: 'Responsables',
  version: 'Versión',
  breveDescripcion: 'Breve descripción',
  producto: 'Producto',
  sh: 'SH',
  documentacionOnePager: 'Documentación One Pager',
  proyectoLinear: 'Proyecto en Linear',
  video: 'Video',
  prototipo: 'Prototipo',
  ia: 'IA',
  informacionBoard: 'Información Board',
  correosAComunicar: 'Correos a comunicar',
  necesitaComunicacionPMKT: 'Necesita comunicación de Product Marketing',
  usuarioImpactado: 'Usuario impactado',
  taxonomiaFeature: 'Taxonomia Feature',
  eventoFeatureAmplitude: 'Evento Feature Amplitude',
  linkTableroAmplitude: 'Link Tablero Amplitude',
  comentarioEvento: 'Comentario evento',
  manualDeUsuario: 'Manual de Usuario',
  articuloHelpCenter: 'Artículo Help Center',
  urlBitacora: 'URL Bitácora',
  status: 'Status',
}

export interface FieldInfo {
  id: string
  name: string
  type: string
  options: string[]
  permissions: { role: string; canEdit: boolean }[]
}

export type FieldMap = Map<string, FieldInfo>

let cache: { at: number; map: FieldMap } | null = null
const CACHE_TTL_MS = 30_000

export async function loadFieldMap(): Promise<FieldMap> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.map

  const fields = await prisma.field.findMany({
    include: { options: { orderBy: { order: 'asc' } }, permissions: true },
  })

  const map: FieldMap = new Map()
  for (const [logicalKey, fieldName] of Object.entries(LOGICAL_FIELD_NAMES)) {
    const field = fields.find((f) => f.name === fieldName)
    if (field) {
      map.set(logicalKey, {
        id: field.id,
        name: field.name,
        type: field.type,
        options: field.options.map((o) => o.name),
        permissions: field.permissions.map((p) => ({ role: p.role, canEdit: p.canEdit })),
      })
    }
  }

  cache = { at: Date.now(), map }
  return map
}

/**
 * Mismo default que usa el panel de admin (admin-panel.tsx): si no hay un
 * FieldPermission explícito para el rol, ADMIN y MANAGER pueden editar,
 * VIEWER solo puede leer.
 */
export function canEditField(info: FieldInfo, role: string): boolean {
  const perm = info.permissions.find((p) => p.role === role)
  if (perm) return perm.canEdit
  return role === 'ADMIN' || role === 'MANAGER'
}

export function mapRecordData(data: Record<string, unknown>, map: FieldMap): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [logicalKey, info] of map.entries()) {
    if (data[info.id] !== undefined) out[logicalKey] = data[info.id]
  }
  const blocks = (data as { __blocks__?: unknown }).__blocks__
  if (blocks !== undefined) out.contenido = blocks
  return out
}

export interface FieldValidationError {
  field: string
  message: string
}

export async function buildDataPatch(
  input: Record<string, unknown>,
  callerRole: string
): Promise<{ patch: Record<string, unknown>; errors: FieldValidationError[] }> {
  const map = await loadFieldMap()
  const patch: Record<string, unknown> = {}
  const errors: FieldValidationError[] = []

  for (const [logicalKey, value] of Object.entries(input)) {
    if (value === undefined) continue

    if (logicalKey === 'contenido') {
      patch.__blocks__ = value
      continue
    }

    const info = map.get(logicalKey)
    if (!info) {
      errors.push({ field: logicalKey, message: `Campo "${logicalKey}" no está configurado en Bitácora.` })
      continue
    }

    if (!canEditField(info, callerRole)) {
      errors.push({
        field: logicalKey,
        message: `No tienes permiso para editar "${info.name}" con tu rol actual (${callerRole}).`,
      })
      continue
    }

    if (info.type === 'select') {
      const str = String(value)
      if (info.options.length > 0 && !info.options.includes(str)) {
        errors.push({
          field: logicalKey,
          message: `Valor "${str}" inválido para "${info.name}". Opciones válidas: ${info.options.join(', ')}`,
        })
        continue
      }
      patch[info.id] = str
    } else if (info.type === 'multiselect') {
      const arr = (Array.isArray(value) ? value : [value]).map(String)
      const invalid = arr.filter((v) => info.options.length > 0 && !info.options.includes(v))
      if (invalid.length > 0) {
        errors.push({
          field: logicalKey,
          message: `Valores inválidos para "${info.name}": ${invalid.join(', ')}. Opciones válidas: ${info.options.join(', ')}`,
        })
        continue
      }
      patch[info.id] = arr
    } else if (info.type === 'person') {
      patch[info.id] = (Array.isArray(value) ? value : [value]).map(String)
    } else {
      patch[info.id] = value
    }
  }

  return { patch, errors }
}
