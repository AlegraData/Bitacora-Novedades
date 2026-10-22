/**
 * Importa el historial de envíos del Apps Script (hoja "Historial", exportada como CSV) y los
 * NOTIFIED_PMKT de la versión anterior de la app. Así esas novedades cuentan como ya comunicadas.
 *
 *   npx tsx scripts/import-legacy-email-history.ts --file historial.csv            (simulacro: no escribe)
 *   npx tsx scripts/import-legacy-email-history.ts --file historial.csv --apply    (escribe)
 *   npx tsx scripts/import-legacy-email-history.ts --audit --apply                 (solo los NOTIFIED_PMKT)
 *
 * Usa el DATABASE_URL del entorno (.env.local). Es idempotente: se puede correr varias veces.
 * Para producción usa la conexión directa (puerto 5432), no el pooler 6543.
 */
import { readFileSync } from 'node:fs'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const fileIdx = args.indexOf('--file')
  const file = fileIdx >= 0 ? args[fileIdx + 1] : undefined
  const audit = args.includes('--audit') || Boolean(file)

  if (!file && !args.includes('--audit')) {
    console.error('Uso: --file <historial.csv> [--apply]   |   --audit [--apply]')
    process.exit(1)
  }

  const { importLegacyHistory, importAuditNotifications } = await import('../src/lib/email/legacy-import')
  const host = new URL(process.env.DATABASE_URL ?? 'postgresql://sin-configurar').host
  console.log(`Base de datos: ${host}`)
  console.log(apply ? 'MODO: ESCRIBIR' : 'MODO: simulacro (no escribe; agrega --apply para aplicar)')

  if (file) {
    const report = await importLegacyHistory(readFileSync(file, 'utf8'), { apply })
    console.log('\nHoja Historial:')
    console.log(`  filas leídas:            ${report.totalRows}`)
    console.log(`  con link válido:         ${report.parsed}`)
    console.log(`  repetidas en el archivo: ${report.duplicatesInFile}`)
    console.log(`  ya importadas/enviadas:  ${report.alreadyImported}`)
    console.log(`  novedad no existe en BD: ${report.unknownRecords.length}`)
    console.log(`  por importar:            ${report.toImport}`)
    if (apply) console.log(`  IMPORTADAS:              ${report.imported}`)
    for (const r of report.invalidRows.slice(0, 10)) console.log(`  ⚠ fila ${r.line}: ${r.reason}`)
    if (report.invalidRows.length > 10) console.log(`  … y ${report.invalidRows.length - 10} filas inválidas más`)
    for (const id of report.unknownRecords.slice(0, 10)) console.log(`  ⚠ no existe en la BD: ${id}`)
  }

  if (audit) {
    const a = await importAuditNotifications({ apply })
    console.log('\nAuditoría (NOTIFIED_PMKT):')
    console.log(`  envíos encontrados: ${a.found}`)
    if (apply) console.log(`  IMPORTADOS:         ${a.imported}`)
  }
  const { prisma } = await import('../src/lib/prisma')
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
