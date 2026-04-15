import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { PrismaClient } from '../src/generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'
import * as fs from 'fs'
import * as path from 'path'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

// ---------------------------------------------------------------------------
// CSV parser robusto: maneja comillas, comas internas y saltos de línea
// ---------------------------------------------------------------------------
function parseCSV(content: string): Record<string, string>[] {
  const rows: string[][] = []
  let current: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    const next = content[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"'
        i++ // saltar segunda comilla
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        current.push(field)
        field = ''
      } else if (ch === '\r' && next === '\n') {
        current.push(field)
        field = ''
        rows.push(current)
        current = []
        i++ // saltar \n
      } else if (ch === '\n') {
        current.push(field)
        field = ''
        rows.push(current)
        current = []
      } else {
        field += ch
      }
    }
  }
  // última fila
  if (field || current.length) {
    current.push(field)
    rows.push(current)
  }

  if (rows.length < 2) return []

  const headers = rows[0].map(h => h.trim())
  return rows.slice(1)
    .filter(row => row.some(cell => cell.trim()))
    .map(row => {
      const obj: Record<string, string> = {}
      headers.forEach((h, idx) => {
        obj[h] = row[idx]?.trim() ?? ''
      })
      return obj
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const EMPTY = new Set(['n/a', 'na', '', 'no aplica', 'ninguno'])

function clean(val: string): string | null {
  const v = val?.trim() ?? ''
  return EMPTY.has(v.toLowerCase()) ? null : v || null
}

function multiselect(val: string): string[] {
  const v = val?.trim() ?? ''
  if (!v || EMPTY.has(v.toLowerCase())) return []
  return v.split(',')
    .map(s => s.trim())
    .filter(s => s && !EMPTY.has(s.toLowerCase()))
}

function parseBool(val: string): boolean {
  return ['si', 'sí', 'yes', 'true', '1'].includes(val?.trim().toLowerCase() ?? '')
}

function parseDate(val: string): string | null {
  const v = val?.trim() ?? ''
  // ISO YYYY-MM-DD — guardar exactamente como viene
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  return null
}

function extractName(email: string | null): string {
  if (!email) return 'Sistema'
  const local = email.split('@')[0] ?? ''
  return local
    .split('.')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('📂 Leyendo CSV...')
  const csvPath = path.join(
    process.cwd(),
    'data',
    'Product - Registro de actividad en publicación _ Novedades y Pre Novedades - Notion (1).csv'
  )
  const raw = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '') // quitar BOM
  const rows = parseCSV(raw)
  console.log(`   ${rows.length} filas encontradas`)

  // ── Leer campos de la DB ─────────────────────────────────────────────────
  const dbFields = await prisma.field.findMany({ orderBy: { order: 'asc' } })
  const byName = new Map(dbFields.map(f => [f.name, f]))

  const fTitulo      = byName.get('Título')
  const fDesc        = byName.get('Breve descripción')
  const fFecha       = byName.get('Fecha de lanzamiento')
  const fTipo        = byName.get('Tipo')
  const fElaborado   = byName.get('Elaborado')
  const fResponsables= byName.get('Responsables')
  const fVersion     = byName.get('Versión')
  const fProducto    = byName.get('Producto')
  const fSH          = byName.get('SH')
  const fCorreos     = byName.get('Correos a comunicar')
  const fDoc         = byName.get('Documentación')
  const fVideo       = byName.get('Video')
  const fEmail       = byName.get('Enviar email')

  const missing = [
    ['Título', fTitulo], ['Breve descripción', fDesc], ['Fecha de lanzamiento', fFecha],
  ].filter(([, f]) => !f).map(([n]) => n)
  if (missing.length) {
    console.error('❌ Campos no encontrados en DB:', missing.join(', '))
    console.error('   Ejecuta npm run seed primero para crear los campos.')
    process.exit(1)
  }

  // ── Borrar registros anteriores ──────────────────────────────────────────
  console.log('🗑️  Eliminando registros existentes...')
  const deleted = await prisma.record.deleteMany()
  console.log(`   ${deleted.count} registros eliminados`)

  // ── Importar ─────────────────────────────────────────────────────────────
  console.log('📝 Importando registros...')
  let created = 0
  let skipped = 0
  const errors: string[] = []

  for (const [idx, row] of rows.entries()) {
    const titulo = clean(row['Titulo'] ?? row['Título'] ?? '')
    if (!titulo) { skipped++; continue }

    try {
      const elaboradoEmail = clean(row['Elaborado'] ?? '') ?? 'sistema@alegra.com'
      const fecha = parseDate(row['Fecha de lanzamiento'] ?? '')

      const data: Record<string, unknown> = {}
      if (fTitulo)       data[fTitulo.id]       = titulo
      if (fDesc)         data[fDesc.id]          = clean(row['Breve descripción'] ?? '') ?? ''
      if (fFecha)        data[fFecha.id]         = fecha
      if (fTipo)         data[fTipo.id]          = clean(row['Tipo'] ?? '')
      if (fElaborado)    data[fElaborado.id]     = elaboradoEmail
      if (fResponsables) data[fResponsables.id]  = multiselect(row['Responsables'] ?? '')
      if (fVersion)      data[fVersion.id]       = multiselect(row['Versión'] ?? '')
      if (fProducto)     data[fProducto.id]      = multiselect(row['Producto'] ?? '')
      if (fSH)           data[fSH.id]            = clean(row['SH'] ?? '')
      if (fCorreos)      data[fCorreos.id]       = multiselect(row['Correos a comunicar'] ?? '')
      if (fDoc)          data[fDoc.id]           = clean(row['Documentación'] ?? '')
      if (fVideo)        data[fVideo.id]         = clean(row['Video'] ?? '')
      if (fEmail)        data[fEmail.id]         = parseBool(row['Enviar email'] ?? '')

      // Usar la fecha de lanzamiento como createdAt para orden cronológico
      const createdAt = fecha ? new Date(fecha + 'T12:00:00Z') : new Date()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await prisma.record.create({
        data: {
          data: data as any,
          createdAt,
          createdByEmail: elaboradoEmail,
          createdByName: extractName(elaboradoEmail),
        },
      })
      created++
    } catch (err) {
      errors.push(`Fila ${idx + 2}: ${titulo?.slice(0, 40)} — ${(err as Error).message}`)
    }
  }

  // ── Resumen ──────────────────────────────────────────────────────────────
  console.log('\n✅ Importación completa:')
  console.log(`   Creados:  ${created}`)
  console.log(`   Omitidos: ${skipped} (sin título)`)
  if (errors.length) {
    console.log(`   Errores:  ${errors.length}`)
    errors.forEach(e => console.log('   ⚠', e))
  }

  // Verificar una muestra
  const sample = await prisma.record.findFirst({ orderBy: { createdAt: 'desc' } })
  if (sample && fTitulo) {
    const d = sample.data as Record<string, unknown>
    console.log('\n📌 Último registro importado:')
    console.log(`   Título: ${d[fTitulo.id]}`)
    console.log(`   Fecha:  ${fFecha ? d[fFecha.id] : '—'}`)
  }
}

main()
  .catch((e) => { console.error('❌ Error fatal:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
