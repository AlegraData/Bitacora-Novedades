import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma'
import { addAuditLog } from '@/lib/actions/audit'
import { updateRecordEmbedding, searchSimilarRecords } from '@/lib/actions/ai'
import { getFields } from '@/lib/actions/fields'
import { buildHtmlEmail } from '@/lib/email-template'
import type { BitacoraRecord, RecordData } from '@/types'
import { loadFieldMap, mapRecordData, buildDataPatch } from './fields'
import type { Caller } from './auth'

type ToolResult = Record<string, unknown>

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
    description: 'Crea una nueva novedad. Solo 4 campos son obligatorios; el resto puede completarse después con update_record.',
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
        prototipo: { type: 'string', description: 'Link de Figma / prototipo de diseño' },
        ia: { type: 'string', description: 'Uso de IA' },
        informacionBoard: { type: 'string', description: 'Estado en board' },
        correosAComunicar: { type: 'array', items: { type: 'string' }, description: 'Correos para notificar' },
        necesitaComunicacionPMKT: { type: 'string', description: 'Requiere comunicación PMKT' },
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
        prototipo: { type: 'string', description: 'Link de Figma / prototipo de diseño' },
        ia: { type: 'string' },
        informacionBoard: { type: 'string' },
        correosAComunicar: {
          type: 'array',
          items: { type: 'string' },
          description: 'Correos para notificar. Por defecto se agregan a los ya existentes (ver "replaceArrays").',
        },
        necesitaComunicacionPMKT: { type: 'string' },
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
    name: 'notify_pmkt',
    description:
      'Dispara el envío de comunicación PMKT para una novedad: notifica al canal de Google Chat y envía correo a los destinatarios de "Correos a comunicar". ' +
      'Antes de enviar valida que título, breve descripción, fecha de lanzamiento y al menos un destinatario estén completos; si falta alguno, devuelve la lista exacta de campos faltantes sin enviar nada. ' +
      'Solo queda marcado como comunicado (y bloqueado para reenvío) si el correo realmente se envió.',
    inputSchema: {
      type: 'object',
      required: ['recordId'],
      properties: { recordId: { type: 'string', description: 'ID de la novedad a comunicar' } },
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
    details: { via: 'mcp', tool: 'create_record' },
  })

  updateRecordEmbedding(record.id, record.data as Record<string, unknown>).catch((e) =>
    console.error('Error al generar embedding (MCP create_record):', e)
  )

  const map = await loadFieldMap()
  return { ...recordBase(record), ...mapRecordData(record.data as Record<string, unknown>, map) }
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
    details: { via: 'mcp', tool: 'update_record', changedFields: Object.keys(patch) },
  })

  updateRecordEmbedding(record.id, record.data as Record<string, unknown>).catch((e) =>
    console.error('Error al generar embedding (MCP update_record):', e)
  )

  return { ...recordBase(record), ...mapRecordData(record.data as Record<string, unknown>, map) }
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
    details: { via: 'mcp', tool: 'delete_record' },
  })

  return { deleted: true, id }
}

export async function handleNotifyPmkt(args: Record<string, unknown>, caller: Caller): Promise<ToolResult> {
  const recordId = String(args.recordId ?? '')
  if (!recordId) return { error: 'El campo "recordId" es obligatorio.' }

  const raw = await prisma.record.findUnique({ where: { id: recordId } })
  if (!raw) return { error: `Registro "${recordId}" no encontrado.` }

  const map = await loadFieldMap()
  const rawData = raw.data as Record<string, unknown>
  const logical = mapRecordData(rawData, map)

  if (logical.necesitaComunicacionPMKT !== 'SI') {
    return { error: 'Este registro no tiene activo el flag "Necesita comunicación de Product Marketing".' }
  }

  const already = await prisma.auditLog.findFirst({ where: { recordId, action: 'NOTIFIED_PMKT' } })
  if (already) {
    return { error: 'Este registro ya fue comunicado previamente.', notifiedAt: already.timestamp.toISOString() }
  }

  const correosField = map.get('correosAComunicar')
  const recipientsRaw = correosField ? rawData[correosField.id] : undefined
  const recipients = (Array.isArray(recipientsRaw) ? recipientsRaw : [])
    .map(String)
    .filter((e) => e.includes('@'))

  // Validación explícita de campos obligatorios ANTES de intentar enviar nada.
  // Antes solo se validaban los destinatarios; si faltaba título/descripción/fecha
  // el correo salía igual con contenido incompleto (o, si RESEND_API_KEY no estaba
  // configurado, el tool igual devolvía "notified: true" sin explicar por qué no
  // llegó nada). Ahora se listan explícitamente los campos que faltan.
  const REQUIRED_NOTIFY_FIELDS: Array<{ key: string; label: string }> = [
    { key: 'titulo', label: 'Título' },
    { key: 'breveDescripcion', label: 'Breve descripción' },
    { key: 'fechaLanzamiento', label: 'Fecha de lanzamiento' },
  ]
  const missingFields = REQUIRED_NOTIFY_FIELDS
    .filter(({ key }) => {
      const v = logical[key]
      return v === undefined || v === null || String(v).trim() === ''
    })
    .map(({ label }) => label)
  if (recipients.length === 0) missingFields.push('Correos a comunicar (mínimo un destinatario válido)')

  if (missingFields.length > 0) {
    return {
      error: 'No se puede comunicar todavía: faltan campos obligatorios en el registro.',
      missingFields,
    }
  }

  const titulo = String(logical.titulo ?? 'Nueva novedad')
  const subject = `📣 PMKT: ${titulo}`

  let emailSent = false
  let emailError: string | undefined
  const RESEND_API_KEY = process.env.RESEND_API_KEY
  if (RESEND_API_KEY) {
    try {
      const fields = await getFields()
      const record: BitacoraRecord = {
        id: raw.id,
        data: raw.data as RecordData,
        createdAt: raw.createdAt.toISOString(),
        updatedAt: raw.updatedAt.toISOString(),
        createdByEmail: raw.createdByEmail,
        createdByName: raw.createdByName,
      }
      const html = buildHtmlEmail(subject, 'Nueva novedad lista para comunicar.', record, fields)
      const FROM = process.env.RESEND_FROM_EMAIL ?? 'Bitácora <noreply@alegra.com>'
      const { Resend } = await import('resend')
      const resend = new Resend(RESEND_API_KEY)
      await resend.emails.send({ from: FROM, to: recipients, subject, html })
      emailSent = true
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e)
      console.error('[notify_pmkt] Error enviando correo vía Resend:', e)
    }
  } else {
    emailError = 'RESEND_API_KEY no está configurado en el servidor.'
    console.warn('[notify_pmkt] RESEND_API_KEY no configurado — se omite el envío de correo.')
  }

  let chatSent = false
  const webhookUrl = process.env.PMKT_CHAT_WEBHOOK_URL
  if (webhookUrl) {
    const chatLines = [`📣 *${titulo}*`]
    if (logical.breveDescripcion) chatLines.push(String(logical.breveDescripcion))
    if (logical.urlBitacora) chatLines.push(String(logical.urlBitacora))

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chatLines.join('\n') }),
      })
      chatSent = res.ok
      if (!res.ok) {
        console.error('[notify_pmkt] Error enviando a Google Chat:', res.status, await res.text().catch(() => ''))
      }
    } catch (e) {
      console.error('[notify_pmkt] Error de red enviando a Google Chat:', e)
    }
  } else {
    console.warn('[notify_pmkt] PMKT_CHAT_WEBHOOK_URL no configurado — se omite el envío a Chat.')
  }

  // Solo se confirma (y se registra en el audit log, que bloquea reintentos) si
  // el correo realmente salió. Antes se marcaba "NOTIFIED_PMKT" aunque
  // RESEND_API_KEY faltara o el envío fallara, dejando el registro bloqueado
  // para siempre sin que el correo hubiera salido nunca.
  if (!emailSent) {
    return {
      error: 'No se pudo enviar el correo de comunicación PMKT.',
      reason: emailError ?? 'Error desconocido',
      chatSent,
    }
  }

  await addAuditLog({
    userId: caller.id,
    userEmail: caller.email,
    userName: caller.name ?? caller.email,
    action: 'NOTIFIED_PMKT',
    recordId,
    details: { via: 'mcp', tool: 'notify_pmkt', emailSent, chatSent, recipients },
  })

  return { notified: true, emailSent, chatSent, recipients }
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
