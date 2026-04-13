import { GoogleGenerativeAI } from '@google/generative-ai'
import { prisma } from '@/lib/prisma'
import { getFields } from './fields'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
// El nombre exacto según el diagnóstico es 'gemini-embedding-001'
const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' })

/**
 * Convierte un registro a una cadena de texto legible para embedding.
 */
async function recordToText(recordData: Record<string, unknown>): Promise<string> {
  const fields = await getFields()
  const fieldMap = Object.fromEntries(fields.map((f) => [f.id, f.name]))

  return Object.entries(recordData)
    .filter(([k]) => fieldMap[k])
    .map(([k, v]) => `${fieldMap[k]}: ${Array.isArray(v) ? v.join(', ') : String(v ?? '')}`)
    .join(' | ')
}

/**
 * Genera y guarda el embedding de un registro.
 */
export async function updateRecordEmbedding(recordId: string, recordData: Record<string, unknown>) {
  if (!process.env.GEMINI_API_KEY) return

  try {
    const content = await recordToText(recordData)
    const result = await embeddingModel.embedContent(content)
    const vector = result.embedding.values

    const vectorString = `[${vector.join(',')}]`
    
    await prisma.$executeRawUnsafe(`
      INSERT INTO "RecordEmbedding" (id, "recordId", content, embedding)
      VALUES (gen_random_uuid(), $1, $2, $3::vector)
      ON CONFLICT ("recordId") DO UPDATE SET
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding
    `, recordId, content, vectorString)
  } catch (error) {
    console.error('Error al actualizar embedding:', error)
  }
}

/**
 * Busca los registros más similares a una consulta.
 */
export async function searchSimilarRecords(query: string, limit = 5) {
  if (!process.env.GEMINI_API_KEY || !query) return []

  try {
    const result = await embeddingModel.embedContent(query)
    const vector = result.embedding.values
    const vectorString = `[${vector.join(',')}]`

    const similarRecords: any[] = await prisma.$queryRawUnsafe(`
      SELECT r.*, re.content, (re.embedding <=> $1::vector) as distance
      FROM "Record" r
      JOIN "RecordEmbedding" re ON r.id = re."recordId"
      ORDER BY distance ASC
      LIMIT $2
    `, vectorString, limit)

    return similarRecords
  } catch (error) {
    console.error('Error en búsqueda semántica:', error)
    return []
  }
}
