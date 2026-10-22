import { prisma } from '@/lib/prisma'

// Importa a EmailDelivery lo que el Apps Script ya comunicó (hoja "Historial"), para que esas novedades
// cuenten como enviadas (lock) y la app no las reenvíe. Columnas de la hoja, según appendRow del script:
// A fecha | B (vacía) | C elaborado | D tipo | E título | F url | G correos | H video

/** CSV mínimo pero correcto: comillas, comas y saltos de línea dentro de comillas, CRLF y BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** Saca el id del registro del link de la bitácora (cualquier dominio: el viejo de Vercel o el nuevo). */
export function recordIdFromUrl(raw: string): string | null {
  try {
    const id = new URL(raw.trim()).searchParams.get('record')
    return id && ID_RE.test(id) ? id : null
  } catch {
    return null
  }
}

function parseDate(raw: string): Date {
  const d = new Date(raw.trim())
  return Number.isNaN(d.getTime()) ? new Date() : d
}

export interface LegacyRow {
  line: number
  recordId: string
  at: Date
  elaborado: string | null
  tipo: string | null
  titulo: string | null
  recipients: string[]
}

export interface ImportReport {
  dryRun: boolean
  totalRows: number
  parsed: number
  invalidRows: { line: number; reason: string }[]
  duplicatesInFile: number
  unknownRecords: string[]
  alreadyImported: number
  toImport: number
  imported: number
}

export function parseLegacyRows(csv: string): { rows: LegacyRow[]; invalid: ImportReport['invalidRows']; total: number } {
  const all = parseCsv(csv)
  // Si la primera fila es encabezado (su columna F no es una URL), se omite.
  const startsWithHeader = all[0] && !/^https?:\/\//i.test((all[0][5] ?? '').trim())
  const data = startsWithHeader ? all.slice(1) : all
  const base = startsWithHeader ? 2 : 1
  const rows: LegacyRow[] = []
  const invalid: ImportReport['invalidRows'] = []
  data.forEach((cols, i) => {
    const line = base + i
    const recordId = recordIdFromUrl(cols[5] ?? '')
    if (!recordId) return void invalid.push({ line, reason: 'La columna F no trae un link con ?record=<id>' })
    rows.push({
      line,
      recordId,
      at: parseDate(cols[0] ?? ''),
      elaborado: cols[2]?.trim() || null,
      tipo: cols[3]?.trim() || null,
      titulo: cols[4]?.trim() || null,
      recipients: (cols[6] ?? '').split(/[,;\n]+/).map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 50),
    })
  })
  return { rows, invalid, total: data.length }
}

export async function importLegacyHistory(csv: string, opts: { apply: boolean }): Promise<ImportReport> {
  const { rows, invalid, total } = parseLegacyRows(csv)

  // Un registro por novedad: si el sheet la tiene repetida, se queda la más antigua (la primera comunicación).
  const byId = new Map<string, LegacyRow>()
  for (const r of rows) {
    const prev = byId.get(r.recordId)
    if (!prev || r.at < prev.at) byId.set(r.recordId, r)
  }
  const ids = [...byId.keys()]

  const [existingRecords, holders] = await Promise.all([
    prisma.record.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    prisma.emailDelivery.findMany({ where: { lockKey: { in: ids.map((id) => `novedad:${id}`) } }, select: { recordId: true } }),
  ])
  const exists = new Set(existingRecords.map((r) => r.id))
  const taken = new Set(holders.map((h) => h.recordId))

  const unknown = ids.filter((id) => !exists.has(id))
  const already = ids.filter((id) => exists.has(id) && taken.has(id))
  const pending = ids.filter((id) => exists.has(id) && !taken.has(id))

  let imported = 0
  if (opts.apply) {
    for (const id of pending) {
      const r = byId.get(id)!
      try {
        await prisma.emailDelivery.create({
          data: {
            recordId: id,
            mode: 'legacy',
            status: 'sent',
            lockKey: `novedad:${id}`,
            subject: [r.tipo, r.titulo].filter(Boolean).join(' | ') || null,
            recipients: r.recipients,
            channel: 'admin',
            trigger: 'manual',
            triggeredByEmail: r.elaborado ?? 'historial@import',
            legacyResponse: 'Importado de la hoja Historial del Apps Script',
            createdAt: r.at,
            finishedAt: r.at,
          },
        })
        imported++
      } catch (e) {
        // Carrera con un envío real que tomó el lock justo ahora: ya cuenta como enviado, se omite.
        if ((e as { code?: string }).code !== 'P2002') throw e
      }
    }
  }

  return {
    dryRun: !opts.apply,
    totalRows: total,
    parsed: rows.length,
    invalidRows: invalid,
    duplicatesInFile: rows.length - byId.size,
    unknownRecords: unknown,
    alreadyImported: already.length,
    toImport: pending.length,
    imported,
  }
}

/** Convierte los NOTIFIED_PMKT de la versión anterior de la app en historial visible (el servicio ya los respeta como "enviado"). */
export async function importAuditNotifications(opts: { apply: boolean }): Promise<{ found: number; imported: number }> {
  const logs = await prisma.auditLog.findMany({ where: { action: 'NOTIFIED_PMKT', recordId: { not: null } }, orderBy: { timestamp: 'asc' } })
  let imported = 0
  const seen = new Set<string>()
  const fresh = logs.filter((l) => {
    if (!l.recordId || seen.has(l.recordId)) return false
    seen.add(l.recordId)
    return true
  })
  if (opts.apply) {
    for (const l of fresh) {
      const details = (l.details ?? {}) as { recipients?: unknown }
      try {
        await prisma.emailDelivery.create({
          data: {
            recordId: l.recordId, mode: 'legacy', status: 'sent', lockKey: `novedad:${l.recordId}`,
            recipients: Array.isArray(details.recipients) ? details.recipients.map(String).slice(0, 50) : [],
            channel: 'admin', trigger: 'manual', triggeredByEmail: l.userEmail, triggeredByName: l.userName,
            legacyResponse: 'Importado de la auditoría (NOTIFIED_PMKT)', createdAt: l.timestamp, finishedAt: l.timestamp,
          },
        })
        imported++
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e
      }
    }
  }
  return { found: fresh.length, imported }
}
