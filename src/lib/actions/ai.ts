import { prisma } from '@/lib/prisma'
import { getFields } from './fields'

// Embeddings por el Gateway de IA de Alegra (LiteLLM, formato OpenAI). La columna RecordEmbedding.embedding es vector(768).
const GATEWAY_URL = (process.env.LITELLM_BASE_URL ?? 'https://alegra-litellm.alegra.com/v1').replace(/\/+$/, '')
const EMBEDDING_MODEL = process.env.LITELLM_EMBEDDING_MODEL ?? 'openai/text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 768
const MAX_EMBEDDING_CHARS = 20000

async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${GATEWAY_URL}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LITELLM_API_KEY}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, MAX_EMBEDDING_CHARS), dimensions: EMBEDDING_DIMENSIONS }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`Gateway de IA respondió ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const vector = (await res.json())?.data?.[0]?.embedding
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) throw new Error('El Gateway de IA devolvió un embedding con formato inesperado')
  return vector
}

/** La búsqueda semántica no pudo ejecutarse (sin llave, Gateway caído o llave inválida, BD). No es «sin resultados». */
export class SemanticSearchUnavailableError extends Error {}

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
  if (!process.env.LITELLM_API_KEY) return

  try {
    const content = await recordToText(recordData)
    const vector = await embedText(content)

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
  if (!query) return []
  if (!process.env.LITELLM_API_KEY) throw new SemanticSearchUnavailableError('LITELLM_API_KEY no configurada')

  try {
    const vector = await embedText(query)
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
    throw new SemanticSearchUnavailableError(error instanceof Error ? error.message : String(error))
  }
}
