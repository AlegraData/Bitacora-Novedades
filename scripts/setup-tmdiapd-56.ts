/**
 * Preparación de datos de TMDIAPD-56. Idempotente; por defecto solo SIMULA (no escribe).
 *   - Crea el campo «¿Trae video?» (selector Sí/No) justo después de «Video».
 *   - Unifica «Pre novedad» con «Pre-novedad» (migra los registros y quita la opción duplicada).
 *   - Imprime las opciones reales del campo «Tipo» para confirmar los nombres de los tipos.
 *
 *   npx tsx scripts/setup-tmdiapd-56.ts            (simulacro)
 *   npx tsx scripts/setup-tmdiapd-56.ts --apply    (escribe)
 *
 * Usa el DATABASE_URL del entorno (.env.local). Para producción usa la conexión directa (5432).
 */
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function main() {
  const apply = process.argv.includes('--apply')
  const { ensureTraeVideoField, unifyPreNovedad } = await import('../src/lib/email/field-setup')
  const { prisma } = await import('../src/lib/prisma')

  const host = new URL(process.env.DATABASE_URL ?? 'postgresql://sin-configurar').host
  console.log(`Base de datos: ${host}`)
  console.log(apply ? 'MODO: ESCRIBIR\n' : 'MODO: simulacro (no escribe; agrega --apply para aplicar)\n')

  const tipo = await unifyPreNovedad({ apply: false })
  console.log('Campo «Tipo»:')
  if (!tipo.tipoField) console.log('  ⚠ no existe un campo llamado «Tipo»')
  else {
    console.log(`  opciones (${tipo.options.length}): ${tipo.options.join(' | ')}`)
    if (tipo.variants.length >= 2) console.log(`  duplicado: ${tipo.variants.join(' ≈ ')} → se unifica en «${tipo.canonical}» (${tipo.recordsToUpdate} registros)`)
    else console.log('  sin duplicados de «Pre novedad»')
  }

  const tv = await ensureTraeVideoField({ apply })
  console.log('\nCampo «¿Trae video?»:')
  console.log(tv.existed ? `  ya existe${tv.addedOptions.length ? ` (faltan opciones: ${tv.addedOptions.join(', ')})` : ' con sus opciones Sí/No'}` : apply ? '  CREADO (selector Sí/No, después de «Video»)' : '  no existe: se creará (selector Sí/No, después de «Video»)')

  if (apply && tipo.variants.length >= 2) {
    const u = await unifyPreNovedad({ apply: true })
    console.log(`\nUnificación aplicada: ${u.updated} registros migrados a «${u.canonical}», ${u.removedOptions} opción(es) duplicada(s) eliminada(s).`)
  }
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
