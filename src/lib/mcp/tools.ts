import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma'
import { addAuditLog } from '@/lib/actions/audit'
import { updateRecordEmbedding, searchSimilarRecords } from '@/lib/actions/ai'
import { sendNovedad, type SendActor, type SendResult } from '@/lib/email/service'
import { toClientResult } from '@/lib/email/public'
import { listDeliveries } from '@/lib/email/history'
import { loadFieldMap, mapRecordData, buildDataPatch } from './fields'
import type { Caller } from './auth'

type ToolResult = Record<string, unknown>

/** Detalle de auditoría que indica por qué canal (MCP o API REST) llegó el cambio. */
export function auditVia(caller: Caller, tool: string, extra: Record<string, unknown> = {}) {
  return caller.via
    ? { via: 'api', tool, apiKeyId: caller.via.apiKeyId, apiKeyName: caller.via.apiKeyName, ...extra }
    : { via: 'mcp', tool, ...extra }
}

const REQUIRED_CREATE_FIELDS = ['tipo', 'titulo', 'fechaLanzamiento', 'elaborado'] as const

function recordBase(r: { id: string; createdAt: Date; updatedAt: Date; createdByEmail: string; createdByName: string }) {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdByEmail: r.createdByEmail,
    createdByName: r.createdByName,
  }
}

export const TOOLS = [
  {
    name: 'list_records',
    description:
      'Lista registros de la Bitácora con filtros opcionales. Retorna un array paginado de novedades.',
    inputSchema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', description: 'Filtrar por tipo de novedad' },
        status: { type: 'string', description: 'Estado del registro' },
        producto: { type: 'array', items: { type: 'string' }, description: 'Uno o varios productos' },
        sh: { type: 'string', description: 'SH asociado' },
        elaborado: { type: 'string', description: 'Email del autor' },
        responsables: { type: 'array', items: { type: 'string' }, description: 'Uno o varios responsables' },
        necesitaComunicacionPMKT: { type: 'string', description: 'Filtrar por flag de PMKT' },
        fechaLanzamientoDesde: { type: 'string', description: 'Inicio del rango de lanzamiento (YYYY-MM-DD)' },
        fechaLanzamientoHasta: { type: 'string', description: 'Fin del rango de lanzamiento (YYYY-MM-DD)' },
        fechaProduccionDesde: { type: 'string', description: 'Inicio del rango de fecha real de producción (YYYY-MM-DD). Excluye novedades sin fecha de producción.' },
        fechaProduccionHasta: { type: 'string', description: 'Fin del rango de fecha real de producción (YYYY-MM-DD)' },
        proyectoLinear: { type: 'string', description: 'Texto contenido en el link/ID del proyecto o issue de Linear (sin distinguir mayúsculas)' },
        query: { type: 'string', description: 'Texto libre — busca en título, descripción y contenido' },
        limit: { type: 'number', description: 'Registros por página. Default: 50' },
        offset: { type: 'number', description: 'Para paginación. Default: 0' },
      },
    },
  },
  {
    name: 'get_record',
    description: 'Retorna un registro completo con todos sus campos a partir del ID.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', description: 'ID interno del registro' } },
    },
  },
  {
    name: 'search_records_semantic',
    description:
      'Búsqueda por significado usando embeddings pgvector + Gemini. Permite consultar novedades en lenguaje natural sin depender de filtros exactos.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Pregunta o descripción en lenguaje natural' },
        limit: { type: 'number', description: 'Cantidad de resultados. Default: 10' },
        producto: { type: 'string', description: 'Producto asociado a la novedad' },
        fechaLanzamientoDesde: { type: 'string', description: 'Inicio del rango de lanzamiento (YYYY-MM-DD)' },
        fechaLanzamientoHasta: { type: 'string', description: 'Fin del rango de lanzamiento (YYYY-MM-DD)' },
      },
    },
  },
  {
    name: 'create_record',
    description: 'Crea una nueva novedad. Solo 4 campos son obligatorios; el resto puede completarse después con update_record. La respuesta incluye "email": el resultado del envío automático (status sent | skipped | failed y el motivo, con missingFields si falta algo para comunicar).',
    inputSchema: {
      type: 'object',
      required: ['tipo', 'titulo', 'fechaLanzamiento', 'elaborado'],
      properties: {
        tipo: { type: 'string', description: 'Tipo de novedad' },
        titulo: { type: 'string', description: 'Título de la novedad' },
        fechaLanzamiento: { type: 'string', description: 'Fecha de lanzamiento planeada (YYYY-MM-DD)' },
        elaborado: { type: 'string', description: 'Email del autor' },
        fechaFinEarlyAdopters: { type: 'string', description: 'Fin de early adopters (YYYY-MM-DD)' },
        fechaProduccion: {
          type: 'string',
          description: 'Fecha real en la que la novedad salió a producción (YYYY-MM-DD). Distinta de "fechaLanzamiento", que es la fecha planeada.',
        },
        responsables: { type: 'array', items: { type: 'string' }, description: 'Emails de responsables' },
        version: { type: 'array', items: { type: 'string' }, description: 'Versiones relacionadas' },
        breveDescripcion: {
          type: 'string',
          description:
            'Resumen en LENGUAJE DE NEGOCIO para stakeholders no técnicos: qué cambia para el usuario y por qué importa. Evita jerga técnica (microservicio, endpoint, refactor, query, backend, API, etc).',
        },
        producto: { type: 'array', items: { type: 'string' }, description: 'Productos impactados' },
        sh: { type: 'string', description: 'SH asociado' },
        documentacionOnePager: { type: 'string', description: 'Link al one pager' },
        proyectoLinear: { type: 'string', description: 'Link o ID del proyecto en Linear' },
        video: { type: 'string', description: 'Link al video' },
        traeVideo: { type: 'string', description: '¿Trae video? Sí o No. Obligatorio para comunicar la novedad; con Sí el correo no sale hasta que se agregue el Video.' },
        prototipo: { type: 'string', description: 'Link de Figma / prototipo de diseño' },
        ia: { type: 'string', description: 'Uso de IA' },
        informacionBoard: { type: 'string', description: 'Estado en board' },
        correosAComunicar: { type: 'array', items: { type: 'string' }, description: 'Correos para notificar' },
        necesitaComunicacionPMKT: {
          type: 'string',
          description: 'Obsoleto (TMDIAPD-16): ya no hace falta configurarlo. Toda novedad/pre-novedad se comunica a PMKT automáticamente en cuanto tiene los campos obligatorios completos; no uses este campo para controlar el envío.',
        },
        usuarioImpactado: { type: 'string', description: 'Tipo de usuario impactado' },
        taxonomiaFeature: { type: 'string', description: 'Taxonomía de la feature' },
        eventoFeatureAmplitude: { type: 'string', description: 'Nombre del evento en Amplitude' },
        linkTableroAmplitude: { type: 'string', description: 'Tablero de Amplitude' },
        comentarioEvento: { type: 'string', description: 'Comentario sobre el evento' },
        manualDeUsuario: { type: 'string', description: 'Link al manual de usuario' },
        articuloHelpCenter: { type: 'string', description: 'Link al artículo de Help Center' },
        status: { type: 'string', description: 'Estado del registro' },
        contenido: { description: 'Cuerpo extenso / rich text' },
      },
    },
  },
  {
    name: 'update_record',
    description:
      'Actualiza campos específicos de un registro existente. Solo se envían los campos que cambian. Solo puede editarlo quien lo creó originalmente o un usuario con rol ADMIN. ' +
      'Los campos de lista (responsables, producto, version, correosAComunicar) se COMBINAN con los valores existentes por defecto — enviar un responsable nuevo lo agrega a la lista, no la reemplaza. Usa "replaceArrays: true" para reemplazar la lista completa (necesario para quitar a alguien).',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'ID del registro a modificar' },
        tipo: { type: 'string' },
        titulo: { type: 'string' },
        fechaLanzamiento: { type: 'string' },
        fechaFinEarlyAdopters: { type: 'string' },
        fechaProduccion: {
          type: 'string',
          description: 'Fecha real en la que la novedad salió a producción (YYYY-MM-DD). Distinta de "fechaLanzamiento", que es la fecha planeada.',
        },
        elaborado: { type: 'string' },
        responsables: {
          type: 'array',
          items: { type: 'string' },
          description: 'Emails de responsables. Por defecto se agregan a los ya existentes (ver "replaceArrays").',
        },
        version: { type: 'array', items: { type: 'string' } },
        breveDescripcion: {
          type: 'string',
          description:
            'Resumen en LENGUAJE DE NEGOCIO para stakeholders no técnicos: qué cambia para el usuario y por qué importa. Evita jerga técnica (microservicio, endpoint, refactor, query, backend, API, etc).',
        },
        producto: { type: 'array', items: { type: 'string' } },
        sh: { type: 'string' },
        documentacionOnePager: { type: 'string' },
        proyectoLinear: { type: 'string' },
        video: { type: 'string' },
        traeVideo: { type: 'string', description: '¿Trae video? Sí o No (con Sí hace falta el campo Video para comunicar).' },
        prototipo: { type: 'string', description: 'Link de Figma / prototipo de diseño' },
        ia: { type: 'string' },
        informacionBoard: { type: 'string' },
        correosAComunicar: {
          type: 'array',
          items: { type: 'string' },
          description: 'Correos para notificar. Por defecto se agregan a los ya existentes (ver "replaceArrays").',
        },
        necesitaComunicacionPMKT: {
          type: 'string',
          description: 'Obsoleto (TMDIAPD-16): ya no hace falta configurarlo. Toda novedad/pre-novedad se comunica a PMKT automáticamente en cuanto tiene los campos obligatorios completos.',
        },
        usuarioImpactado: { type: 'string' },
        taxonomiaFeature: { type: 'string' },
        eventoFeatureAmplitude: { type: 'string' },
        linkTableroAmplitude: { type: 'string' },
        comentarioEvento: { type: 'string' },
        manualDeUsuario: { type: 'string' },
        articuloHelpCenter: { type: 'string' },
        urlBitacora: { type: 'string' },
        status: { type: 'string' },
        contenido: { description: 'Cuerpo extenso / rich text' },
        replaceArrays: {
          type: 'boolean',
          description:
            'Si es true, los campos de lista enviados en esta llamada (responsables, producto, version, correosAComunicar) reemplazan por completo la lista existente en vez de agregarse a ella. Default: false (agrega/combina).',
        },
      },
    },
  },
  {
    name: 'delete_record',
    description: 'Elimina un registro permanentemente. Acción irreversible, restringida a rol ADMIN.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', description: 'ID del registro a eliminar' } },
    },
    requiredRole: 'ADMIN' as const,
  },
  {
    name: 'list_audit_log',
    description:
      'Lista el historial de cambios sobre registros o acciones de usuarios, incluyendo envíos de comunicación PMKT.',
    inputSchema: {
      type: 'object',
      properties: {
        recordId: { type: 'string', description: 'Filtrar por registro específico' },
        userId: { type: 'string', description: 'Filtrar por usuario que hizo el cambio' },
        desde: { type: 'string', description: 'Inicio del rango de fecha (YYYY-MM-DD)' },
        hasta: { type: 'string', description: 'Fin del rango de fecha (YYYY-MM-DD)' },
        limit: { type: 'number', description: 'Default: 50' },
      },
    },
  },
  {
    name: 'list_email_deliveries',
    description:
      'Historial de envíos de correo de las novedades: quién lo disparó, cuándo, por qué canal, a quién, con qué resultado (sent | failed | simulated | sending) y, si falló, el motivo (errorCode / errorMessage). ' +
      'Úsalo para saber si una novedad ya se comunicó, cuándo y por qué falló un envío. Filtra por recordId para ver una novedad.',
    inputSchema: {
      type: 'object',
      properties: {
        recordId: { type: 'string', description: 'Filtrar por novedad' },
        status: { type: 'string', description: 'sending | sent | failed | simulated' },
        mode: { type: 'string', description: 'webhook | shadow | test | live | simulate | legacy' },
        limit: { type: 'number', description: 'Default 50, máximo 200' },
        offset: { type: 'number', description: 'Para paginación' },
      },
    },
  },
  {
    name: 'notify_pmkt',
    description:
      'Fallback MANUAL (TMDIAPD-16): toda novedad/pre-novedad se comunica a PMKT automáticamente en cuanto tiene los campos obligatorios completos — normalmente NO hace falta llamar a este tool. ' +
      'Úsalo solo para reintentar un envío que falló o para depurar por qué un registro no se ha comunicado. ' +
      'Envía el correo a los destinatarios configurados en el admin (y avisa al canal de Google Chat mencionándolos). Aplica a TODOS los tipos de novedad. ' +
      'Antes de enviar valida que título, breve descripción, fecha de lanzamiento, fecha real de producción, al menos un responsable y «¿Trae video?» estén completos (y el Video si «¿Trae video?» es Sí); si falta alguno, devuelve error.missingFields con la lista exacta, sin enviar nada, y la novedad queda pendiente hasta completarlo. ' +
      'Flujo en dos pasos: llamar SIN "confirm" devuelve un simulacro (asunto, destinatarios y texto exactos del correo) sin enviar nada; hay que mostrárselo al usuario y volver a llamar con "confirm: true" para el envío real. ' +
      'La respuesta siempre trae status (sent | simulated | failed | skipped) y, si falló, error.code y error.message con el motivo (ej. DUPLICATE, VALIDATION, SMTP_AUTH, RECIPIENT_REJECTED, RATE_LIMIT, SMTP_NOT_CONFIGURED). ' +
      'Una novedad ya enviada no se reenvía: solo un ADMIN puede forzarlo con "resend: true" y un "reason".',
    inputSchema: {
      type: 'object',
      required: ['recordId'],
      properties: {
        recordId: { type: 'string', description: 'ID de la novedad a comunicar' },
        confirm: {
          type: 'boolean',
          description: 'Debe ser true para disparar el envío real. Sin este parámetro (o en false) solo se simula y se devuelve el preview, sin enviar nada.',
        },
        resend: { type: 'boolean', description: 'Solo ADMIN: reenviar una novedad que ya se comunicó. Requiere "reason".' },
        reason: { type: 'string', description: 'Motivo del reenvío (obligatorio con resend: true).' },
      },
    },
  },
]

export async function handleListRecords(args: Record<string, unknown>): Promise<ToolResult> {
  const map = await loadFieldMap()
  const limit = Math.min(Number(args.limit) || 50, 200)
  const offset = Math.max(Number(args.offset) || 0, 0)

  const raw = await prisma.record.findMany({ orderBy: { createdAt: 'desc' } })
  let records = raw.map((r) => ({
    ...recordBase(r),
    ...mapRecordData(r.data as Record<string, unknown>, map),
  })) as Array<Record<string, unknown>>

  const eq = (key: string, val: unknown) => records.filter((r) => r[key] === val)
  if (typeof args.tipo === 'string') records = eq('tipo', args.tipo)
  if (typeof args.status === 'string') records = eq('status', args.status)
  if (typeof args.sh === 'string') records = eq('sh', args.sh)
  if (typeof args.necesitaComunicacionPMKT === 'string') records = eq('necesitaComunicacionPMKT', args.necesitaComunicacionPMKT)

  if (typeof args.elaborado === 'string') {
    records = records.filter((r) => Array.isArray(r.elaborado) && (r.elaborado as string[]).includes(args.elaborado as string))
  }
  if (args.producto) {
    const wanted = Array.isArray(args.producto) ? args.producto.map(String) : [String(args.producto)]
    records = records.filter((r) => Array.isArray(r.producto) && wanted.some((p) => (r.producto as string[]).includes(p)))
  }
  if (args.responsables) {
    const wanted = Array.isArray(args.responsables) ? args.responsables.map(String) : [String(args.responsables)]
    records = records.filter((r) => Array.isArray(r.responsables) && wanted.some((e) => (r.responsables as string[]).includes(e)))
  }
  if (typeof args.fechaLanzamientoDesde === 'string') {
    records = records.filter((r) => typeof r.fechaLanzamiento === 'string' && (r.fechaLanzamiento as string) >= (args.fechaLanzamientoDesde as string))
  }
  if (typeof args.fechaLanzamientoHasta === 'string') {
    records = records.filter((r) => typeof r.fechaLanzamiento === 'string' && (r.fechaLanzamiento as string) <= (args.fechaLanzamientoHasta as string))
  }
  if (typeof args.fechaProduccionDesde === 'string') {
    records = records.filter((r) => typeof r.fechaProduccion === 'string' && (r.fechaProduccion as string) >= (args.fechaProduccionDesde as string))
  }
  if (typeof args.fechaProduccionHasta === 'string') {
    records = records.filter((r) => typeof r.fechaProduccion === 'string' && (r.fechaProduccion as string) <= (args.fechaProduccionHasta as string))
  }
  if (typeof args.proyectoLinear === 'string' && args.proyectoLinear.trim()) {
    const needle = args.proyectoLinear.trim().toLowerCase()
    records = records.filter((r) => typeof r.proyectoLinear === 'string' && (r.proyectoLinear as string).toLowerCase().includes(needle))
  }
  if (typeof args.query === 'string' && args.query.trim()) {
    const q = args.query.toLowerCase()
    records = records.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q)))
  }

  const total = records.length
  const page = records.slice(offset, offset + limit)
  return { total, limit, offset, records: page }
}

export async function handleGetRecord(args: Record<string, unknown>): Promise<ToolResult> {
  const id = String(args.id ?? '')
  if (!id) return { error: 'El campo "id" es obligatorio.' }

  const r = await prisma.record.findUnique({ where: { id } })
  if (!r) return { error: `Registro "${id}" no encontrado.` }

  const map = await loadFieldMap()
  return { ...recordBase(r), ...mapRecordData(r.data as Record<string, unknown>, map) }
}

export async function handleSearchRecordsSemantic(args: Record<string, unknown>): Promise<ToolResult> {
  const query = String(args.query ?? '')
  if (!query.trim()) return { error: 'El campo "query" es obligatorio.' }

  const limit = Math.min(Number(args.limit) || 10, 50)
  const map = await loadFieldMap()

  type SemanticRow = {
    id: string
    createdAt: Date
    updatedAt: Date
    createdByEmail: string
    createdByName: string
    data: Record<string, unknown>
    distance: number
  }
  const raw = (await searchSimilarRecords(query, limit)) as SemanticRow[]

  let results = raw.map((r) => ({
    ...recordBase(r),
    distance: r.distance,
    ...mapRecordData(r.data, map),
  })) as Array<Record<string, unknown>>

  if (typeof args.producto === 'string') {
    results = results.filter((r) => Array.isArray(r.producto) && (r.producto as string[]).includes(args.producto as string))
  }
  if (typeof args.fechaLanzamientoDesde === 'string') {
    results = results.filter((r) => typeof r.fechaLanzamiento === 'string' && (r.fechaLanzamiento as string) >= (args.fechaLanzamientoDesde as string))
  }
  if (typeof args.fechaLanzamientoHasta === 'string') {
    results = results.filter((r) => typeof r.fechaLanzamiento === 'string' && (r.fechaLanzamiento as string) <= (args.fechaLanzamientoHasta as string))
  }

  return { results }
}

export async function handleCreateRecord(args: Record<string, unknown>, caller: Caller): Promise<ToolResult> {
  for (const key of REQUIRED_CREATE_FIELDS) {
    const v = args[key]
    if (v === undefined || v === null || v === '') {
      return { error: `El campo "${key}" es obligatorio.` }
    }
  }

  const { patch, errors } = await buildDataPatch(args)
  if (errors.length > 0) return { error: 'Validación fallida', details: errors }

  const record = await prisma.record.create({
    data: {
      data: patch as Prisma.InputJsonValue,
      createdByEmail: caller.email,
      createdByName: caller.name ?? caller.email,
    },
  })

  await addAuditLog({
    userId: caller.id,
    userEmail: caller.email,
    userName: caller.name ?? caller.email,
    action: 'CREATED_RECORD',
    recordId: record.id,
    details: auditVia(caller, 'create_record'),
  })

  updateRecordEmbedding(record.id, record.data as Record<string, unknown>).catch((e) =>
    console.error('Error al generar embedding (create_record):', e)
  )

  const email = await autoSend(record.id, caller)

  const map = await loadFieldMap()
  return { ...recordBase(record), ...mapRecordData(record.data as Record<string, unknown>, map), email }
}

export async function handleUpdateRecord(args: Record<string, unknown>, caller: Caller): Promise<ToolResult> {
  const id = String(args.id ?? '')
  if (!id) return { error: 'El campo "id" es obligatorio.' }

  const existing = await prisma.record.findUnique({ where: { id } })
  if (!existing) return { error: `Registro "${id}" no encontrado.` }

  if (existing.createdByEmail !== caller.email && caller.role !== 'ADMIN') {
    return { error: `No puedes editar este registro — fue creado por ${existing.createdByEmail}. Solo su autor o un ADMIN pueden modificarlo.` }
  }

  const { id: _omit, replaceArrays, ...rest } = args
  void _omit
  const { patch, errors } = await buildDataPatch(rest)
  if (errors.length > 0) return { error: 'Validación fallida', details: errors }

  const existingData = existing.data as Record<string, unknown>
  const map = await loadFieldMap()
  const fieldsById = new Map([...map.values()].map((info) => [info.id, info]))

  const mergedPatch: Record<string, unknown> = {}
  for (const [fieldId, value] of Object.entries(patch)) {
    const info = fieldsById.get(fieldId)
    const isListField = info && (info.type === 'person' || info.type === 'multiselect')
    if (isListField && !replaceArrays && Array.isArray(value)) {
      const prev = Array.isArray(existingData[fieldId]) ? (existingData[fieldId] as unknown[]).map(String) : []
      mergedPatch[fieldId] = Array.from(new Set([...prev, ...value.map(String)]))
    } else {
      mergedPatch[fieldId] = value
    }
  }

  const mergedData = { ...existingData, ...mergedPatch }

  const record = await prisma.record.update({
    where: { id },
    data: { data: mergedData as Prisma.InputJsonValue },
  })

  await addAuditLog({
    userId: caller.id,
    userEmail: caller.email,
    userName: caller.name ?? caller.email,
    action: 'UPDATED_RECORD',
    recordId: record.id,
    details: auditVia(caller, 'update_record', { changedFields: Object.keys(patch) }),
  })

  updateRecordEmbedding(record.id, record.data as Record<string, unknown>).catch((e) =>
    console.error('Error al generar embedding (update_record):', e)
  )

  const email = await autoSend(record.id, caller)

  return { ...recordBase(record), ...mapRecordData(record.data as Record<string, unknown>, map), email }
}

export async function handleDeleteRecord(args: Record<string, unknown>, caller: Caller): Promise<ToolResult> {
  const id = String(args.id ?? '')
  if (!id) return { error: 'El campo "id" es obligatorio.' }

  const existing = await prisma.record.findUnique({ where: { id } })
  if (!existing) return { error: `Registro "${id}" no encontrado.` }

  await prisma.record.delete({ where: { id } })

  await addAuditLog({
    userId: caller.id,
    userEmail: caller.email,
    userName: caller.name ?? caller.email,
    action: 'DELETED_RECORD',
    recordId: id,
    details: auditVia(caller, 'delete_record'),
  })

  return { deleted: true, id }
}

export async function handleNotifyPmkt(args: Record<string, unknown>, caller: Caller): Promise<ToolResult> {
  const recordId = String(args.recordId ?? '')
  if (!recordId) return { error: 'El campo "recordId" es obligatorio.' }

  // TMDIAPD-16: el disparo normal es automático (ver autoSend en create/update). Este tool es el
  // fallback manual: reintentar un envío que falló, simular, o depurar por qué no se comunicó.
  // Sin confirm:true solo simula (preview del correo exacto); con confirm:true envía de verdad.
  const real = args.confirm === true
  const resend = args.resend === true ? { reason: String(args.reason ?? '') } : undefined
  const result = await sendNovedad({
    recordId,
    actor: actorOf(caller),
    channel: caller.via ? 'api' : 'mcp',
    trigger: 'manual',
    simulate: !real,
    resend,
  })
  const shaped = toClientResult(result, caller.role, { text: !real })
  if (real) return { ...shaped }
  return {
    preview: true,
    ...shaped,
    instrucciones: 'Esto es un simulacro: no se envió nada. Revisa asunto, destinatarios y texto; para enviar de verdad vuelve a llamar con confirm: true.',
  }
}

export async function handleListEmailDeliveries(args: Record<string, unknown>, caller: Caller): Promise<ToolResult> {
  return { ...(await listDeliveries(caller.role, args)) }
}

function actorOf(caller: Caller): SendActor {
  return { id: caller.id, email: caller.email, name: caller.name, role: caller.role }
}

/** Envío automático tras crear/editar: se espera el resultado y se devuelve; nunca hace fallar la escritura. */
async function autoSend(recordId: string, caller: Caller): Promise<SendResult> {
  try {
    return toClientResult(
      await sendNovedad({ recordId, actor: actorOf(caller), channel: caller.via ? 'api' : 'mcp', trigger: 'auto' }),
      caller.role
    )
  } catch (e) {
    console.error('[email] auto-envío falló:', e)
    return { ok: false, status: 'failed', error: { code: 'UNKNOWN', message: 'No se pudo procesar el envío automático.' } }
  }
}

export async function handleListAuditLog(args: Record<string, unknown>): Promise<ToolResult> {
  const where: Prisma.AuditLogWhereInput = {}

  if (typeof args.recordId === 'string') where.recordId = args.recordId
  if (typeof args.userId === 'string') where.userId = args.userId

  if (typeof args.desde === 'string' || typeof args.hasta === 'string') {
    where.timestamp = {}
    if (typeof args.desde === 'string') where.timestamp.gte = new Date(args.desde)
    if (typeof args.hasta === 'string') {
      const end = new Date(args.hasta)
      end.setUTCHours(23, 59, 59, 999)
      where.timestamp.lte = end
    }
  }

  const limit = Math.min(Number(args.limit) || 50, 200)
  const logs = await prisma.auditLog.findMany({ where, orderBy: { timestamp: 'desc' }, take: limit })

  return {
    total: logs.length,
    logs: logs.map((l) => ({
      id: l.id,
      timestamp: l.timestamp.toISOString(),
      userEmail: l.userEmail,
      userName: l.userName,
      action: l.action,
      recordId: l.recordId,
      details: l.details,
    })),
  }
}
