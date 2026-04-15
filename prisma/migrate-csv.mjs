// migrate-csv.mjs — ESM, no transpilation needed, runs with plain node
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local manually
const envPath = join(__dirname, '..', '.env.local')
try {
  const envContent = readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch { /* ignore */ }

const { PrismaClient } = await import('../src/generated/prisma/index.js')
const { PrismaPg } = await import('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// ---------------------------------------------------------------------------
// CSV parser robusto: maneja comillas, comas internas y saltos de línea
// ---------------------------------------------------------------------------
function parseCSV(content) {
  const rows = []
  let current = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    const next = content[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"'
        i++
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
        i++
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
  if (field || current.length) {
    current.push(field)
    rows.push(current)
  }

  if (rows.length < 2) return []

  const headers = rows[0].map(h => h.trim())
  return rows.slice(1)
    .filter(row => row.some(cell => cell.trim()))
    .map(row => {
      const obj = {}
      headers.forEach((h, idx) => { obj[h] = row[idx]?.trim() ?? '' })
      return obj
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const EMPTY = new Set(['n/a', 'na', '', 'no aplica', 'ninguno'])

function clean(val) {
  const v = val?.trim() ?? ''
  return EMPTY.has(v.toLowerCase()) ? null : v || null
}

function multiselect(val) {
  const v = val?.trim() ?? ''
  if (!v || EMPTY.has(v.toLowerCase())) return []
  return v.split(',').map(s => s.trim()).filter(s => s && !EMPTY.has(s.toLowerCase()))
}

function parseBool(val) {
  return ['si', 'sí', 'yes', 'true', '1'].includes(val?.trim().toLowerCase() ?? '')
}

function parseDate(val) {
  const v = val?.trim() ?? ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  return null
}

function extractName(email) {
  if (!email) return 'Sistema'
  const local = email.split('@')[0] ?? ''
  return local.split('.').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('📂 Leyendo CSV...')
  const csvPath = join(
    __dirname, '..', 'data',
    'Product - Registro de actividad en publicación _ Novedades y Pre Novedades - Notion (1).csv'
  )
  const raw = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '')
  const rows = parseCSV(raw)
  console.log(`   ${rows.length} filas encontradas`)

  const dbFields = await prisma.field.findMany({ orderBy: { order: 'asc' } })
  const byName = new Map(dbFields.map(f => [f.name, f]))

  const fTitulo       = byName.get('Título')
  const fDesc         = byName.get('Breve descripción')
  const fFecha        = byName.get('Fecha de lanzamiento')
  const fTipo         = byName.get('Tipo')
  const fElaborado    = byName.get('Elaborado')
  const fResponsables = byName.get('Responsables')
  const fVersion      = byName.get('Versión')
  const fProducto     = byName.get('Producto')
  const fSH           = byName.get('SH')
  const fCorreos      = byName.get('Correos a comunicar')
  const fDoc          = byName.get('Documentación')
  const fVideo        = byName.get('Video')
  const fEmailField   = byName.get('Enviar email')

  if (!fTitulo || !fDesc || !fFecha) {
    console.error('❌ Campos base no encontrados en DB. Ejecuta npm run seed primero.')
    process.exit(1)
  }

  console.log('🗑️  Eliminando registros existentes...')
  const deleted = await prisma.record.deleteMany()
  console.log(`   ${deleted.count} registros eliminados`)

  console.log('📝 Importando...')
  let created = 0
  let skipped = 0
  const errors = []

  for (const [idx, row] of rows.entries()) {
    const titulo = clean(row['Titulo'] ?? row['Título'] ?? '')
    if (!titulo) { skipped++; continue }

    try {
      const elaboradoEmail = clean(row['Elaborado'] ?? '') ?? 'sistema@alegra.com'
      const fecha = parseDate(row['Fecha de lanzamiento'] ?? '')

      const data = {}
      data[fTitulo.id]       = titulo
      data[fDesc.id]         = clean(row['Breve descripción'] ?? '') ?? ''
      data[fFecha.id]        = fecha
      if (fTipo)         data[fTipo.id]          = clean(row['Tipo'] ?? '')
      if (fElaborado)    data[fElaborado.id]     = elaboradoEmail
      if (fResponsables) data[fResponsables.id]  = multiselect(row['Responsables'] ?? '')
      if (fVersion)      data[fVersion.id]       = multiselect(row['Versión'] ?? '')
      if (fProducto)     data[fProducto.id]      = multiselect(row['Producto'] ?? '')
      if (fSH)           data[fSH.id]            = clean(row['SH'] ?? '')
      if (fCorreos)      data[fCorreos.id]       = multiselect(row['Correos a comunicar'] ?? '')
      if (fDoc)          data[fDoc.id]           = clean(row['Documentación'] ?? '')
      if (fVideo)        data[fVideo.id]         = clean(row['Video'] ?? '')
      if (fEmailField)   data[fEmailField.id]    = parseBool(row['Enviar email'] ?? '')

      const createdAt = fecha ? new Date(fecha + 'T12:00:00Z') : new Date()

      await prisma.record.create({
        data: { data, createdAt, createdByEmail: elaboradoEmail, createdByName: extractName(elaboradoEmail) }
      })
      created++

      if (created % 50 === 0) console.log(`   ... ${created} importados`)
    } catch (err) {
      errors.push(`Fila ${idx + 2}: "${titulo?.slice(0, 40)}" — ${err.message}`)
    }
  }

  console.log('\n✅ Importación completa:')
  console.log(`   Creados:  ${created}`)
  console.log(`   Omitidos: ${skipped}`)
  if (errors.length) {
    console.log(`   Errores:  ${errors.length}`)
    errors.slice(0, 10).forEach(e => console.log('   ⚠', e))
  }

  const sample = await prisma.record.findFirst({ orderBy: { createdAt: 'desc' } })
  if (sample) {
    const d = sample.data
    console.log('\n📌 Muestra (más reciente):')
    console.log(`   Título: ${d[fTitulo.id]}`)
    console.log(`   Fecha:  ${d[fFecha.id]}`)
  }
}

main()
  .catch(e => { console.error('❌', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
