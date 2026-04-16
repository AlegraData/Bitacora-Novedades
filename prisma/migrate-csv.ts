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

  const headers = rows[0].map((h) => h.trim())
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => {
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

function clean(val: string | undefined): string | null {
  const v = val?.trim() ?? ''
  return EMPTY.has(v.toLowerCase()) ? null : v || null
}

function multiselect(val: string | undefined): string[] {
  const v = val?.trim() ?? ''
  if (!v || EMPTY.has(v.toLowerCase())) return []
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !EMPTY.has(s.toLowerCase()))
}

function parseBool(val: string | undefined): boolean {
  return ['si', 'sí', 'yes', 'true', '1'].includes(val?.trim().toLowerCase() ?? '')
}

function parseDate(val: string | undefined): string | null {
  const v = val?.trim() ?? ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  return null
}

function extractName(email: string | null): string {
  if (!email) return 'Sistema'
  const local = email.split('@')[0] ?? ''
  return local
    .split('.')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
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
  // Leer como UTF-8 y quitar BOM — preserva emojis y caracteres especiales
  const raw = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '')
  const rows = parseCSV(raw)
  console.log(`   ${rows.length} filas encontradas`)

  // ── Leer todos los campos de la DB ────────────────────────────────────────
  const dbFields = await prisma.field.findMany({ orderBy: { order: 'asc' } })
  const byName = new Map(dbFields.map((f) => [f.name, f]))

  // Campos obligatorios
  const fTitulo = byName.get('Título')
  const fDesc   = byName.get('Breve descripción')
  const fFecha  = byName.get('Fecha de lanzamiento')

  const missing = [
    ['Título', fTitulo],
    ['Breve descripción', fDesc],
    ['Fecha de lanzamiento', fFecha],
  ]
    .filter(([, f]) => !f)
    .map(([n]) => n)

  if (missing.length) {
    console.error('❌ Campos no encontrados en DB:', missing.join(', '))
    console.error('   Ejecuta primero: npx tsx prisma/sync-schema.ts')
    process.exit(1)
  }

  // Campos opcionales — se ignoran si no existen en la DB
  const fTipo       = byName.get('Tipo')
  const fElaborado  = byName.get('Elaborado')
  const fRespons    = byName.get('Responsables')
  const fVersion    = byName.get('Versión')
  const fProducto   = byName.get('Producto')
  const fSH         = byName.get('SH')
  const fCorreos    = byName.get('Correos a comunicar')
  const fDoc        = byName.get('Documentación')
  const fVideo      = byName.get('Video')
  const fEmail      = byName.get('Enviar email')
  // Campos nuevos del CSV
  const fNecesita   = byName.get('Necesita comunicación de Product Marketing')
  const fUsuario    = byName.get('Usuario impactado')
  const fTaxonomia  = byName.get('Taxonomia Feature')
  const fEvento     = byName.get('Evento Feature Amplitude')
  const fComentario = byName.get('Comentario evento')
  const fLinkAmp    = byName.get('Link Tablero Amplitude')
  const fArticulo   = byName.get('Artículo Help Center')
  const fStatus     = byName.get('Status')
  const fIA         = byName.get('IA')
  const fInfoBoard  = byName.get('Información Board')

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
    // El CSV tiene columna "Titulo" (sin tilde) para el valor real
    const titulo = clean(row['Titulo'] ?? row['Título'] ?? '')
    if (!titulo) { skipped++; continue }

    try {
      const elaboradoEmail = clean(row['Elaborado'] ?? '') ?? 'sistema@alegra.com'
      const fecha = parseDate(row['Fecha de lanzamiento'] ?? '')

      const data: Record<string, unknown> = {}

      // Campos base
      if (fTitulo)   data[fTitulo.id]   = titulo
      if (fDesc)     data[fDesc.id]     = clean(row['Breve descripción'] ?? '') ?? ''
      if (fFecha)    data[fFecha.id]    = fecha
      if (fTipo)     data[fTipo.id]     = clean(row['Tipo'] ?? '')
      if (fElaborado) data[fElaborado.id] = elaboradoEmail
      if (fRespons)  data[fRespons.id]  = multiselect(row['Responsables'] ?? '')
      if (fVersion)  data[fVersion.id]  = multiselect(row['Versión'] ?? '')
      if (fProducto) data[fProducto.id] = multiselect(row['Producto'] ?? '')
      if (fSH)       data[fSH.id]       = clean(row['SH'] ?? '')
      if (fCorreos)  data[fCorreos.id]  = multiselect(row['Correos a comunicar'] ?? '')
      if (fDoc)      data[fDoc.id]      = clean(row['Documentación'] ?? '')
      if (fVideo)    data[fVideo.id]    = clean(row['Video'] ?? '')
      if (fEmail)    data[fEmail.id]    = parseBool(row['Enviar email'] ?? '')

      // Campos nuevos del CSV
      if (fNecesita)   data[fNecesita.id]   = clean(row['Necesita comunicación de Product Marketing'] ?? '')
      if (fUsuario)    data[fUsuario.id]    = multiselect(row['Usuario impactado'] ?? '')
      if (fTaxonomia)  data[fTaxonomia.id]  = multiselect(row['Taxonomia Feature'] ?? '')
      // CSV "Evento Feature" → campo "Evento Feature Amplitude"
      if (fEvento)     data[fEvento.id]     = clean(row['Evento Feature'] ?? '')
      if (fComentario) data[fComentario.id] = clean(row['Comentario evento'] ?? '')
      // CSV "Link Amplitude" → campo "Link Tablero Amplitude"
      if (fLinkAmp)    data[fLinkAmp.id]    = clean(row['Link Amplitude'] ?? '')
      // CSV "Artículo" → campo "Artículo Help Center"
      if (fArticulo)   data[fArticulo.id]   = clean(row['Artículo'] ?? '')
      if (fStatus)     data[fStatus.id]     = clean(row['Status'] ?? '')
      if (fIA)         data[fIA.id]         = clean(row['IA'] ?? '')
      if (fInfoBoard)  data[fInfoBoard.id]  = clean(row['Información Board'] ?? '')

      // Usar fecha de lanzamiento como createdAt para orden cronológico
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
    errors.forEach((e) => console.log('   ⚠', e))
  }

  // Verificar muestra
  const sample = await prisma.record.findFirst({ orderBy: { createdAt: 'desc' } })
  if (sample && fTitulo) {
    const d = sample.data as Record<string, unknown>
    console.log('\n📌 Último registro importado:')
    console.log(`   Título: ${d[fTitulo.id]}`)
    console.log(`   Fecha:  ${fFecha ? d[fFecha.id] : '—'}`)
    if (fNecesita) console.log(`   Necesita PM: ${d[fNecesita.id] ?? '—'}`)
    if (fTaxonomia) console.log(`   Taxonomia: ${JSON.stringify(d[fTaxonomia.id] ?? [])}`)
  }
}

main()
  .catch((e) => { console.error('❌ Error fatal:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
