/**
 * Genera los embeddings de las novedades que no tienen (p. ej. las creadas mientras la llave de Gemini
 * era inválida). Necesario para que la búsqueda semántica las encuentre. Con --all rehace todos: hay que
 * usarlo una vez al cambiar de modelo, porque los vectores de modelos distintos no son comparables.
 *
 *   npx tsx scripts/backfill-embeddings.ts            (simulacro: solo cuenta)
 *   npx tsx scripts/backfill-embeddings.ts --apply    (genera y guarda)
 *   npx tsx scripts/backfill-embeddings.ts --apply --all   (rehace también los existentes)
 *
 * Usa DATABASE_URL y LITELLM_API_KEY (Gateway de IA) de .env.local. Es idempotente. Para producción usa la conexión
 * directa (puerto 5432), no el pooler 6543.
 */
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const all = args.includes('--all')

  const { prisma } = await import('../src/lib/prisma')
  const { updateRecordEmbedding } = await import('../src/lib/actions/ai')

  const host = new URL(process.env.DATABASE_URL ?? 'postgresql://sin-configurar').host
  console.log(`Base de datos: ${host}`)
  console.log(apply ? 'MODO: ESCRIBIR' : 'MODO: simulacro (no escribe; agrega --apply para aplicar)')

  const rows = all
    ? await prisma.record.findMany({ select: { id: true, data: true }, orderBy: { createdAt: 'asc' } })
    : await prisma.$queryRawUnsafe<{ id: string; data: Record<string, unknown> }[]>(
        `SELECT r.id, r.data FROM "Record" r LEFT JOIN "RecordEmbedding" re ON re."recordId" = r.id WHERE re.id IS NULL ORDER BY r."createdAt" ASC`,
      )
  console.log(`Novedades a procesar: ${rows.length}`)
  if (!apply || rows.length === 0) return
  if (!process.env.LITELLM_API_KEY) throw new Error('LITELLM_API_KEY no está en .env.local')

  for (const [i, r] of rows.entries()) {
    await updateRecordEmbedding(r.id, r.data as Record<string, unknown>)
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${rows.length}`)
  }

  const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "Record" r LEFT JOIN "RecordEmbedding" re ON re."recordId" = r.id WHERE re.id IS NULL`,
  )
  console.log(`Sin embedding tras el proceso: ${n}`)
  if (Number(n) > 0) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => process.exit())
