import type { NextRequest } from 'next/server'

export const MAX_BODY_BYTES = 1_000_000

export class BodyError extends Error {
  constructor(public status: 400 | 413 | 415, public code: string, message: string) {
    super(message)
  }
}

/** Lee el body como un objeto JSON plano (no arreglo, no primitivo), con tope de tamaño. */
export async function readJsonObject(request: NextRequest): Promise<Record<string, unknown>> {
  const type = request.headers.get('content-type') ?? ''
  if (!/^application\/json\b/i.test(type)) {
    throw new BodyError(415, 'unsupported_media_type', 'El Content-Type debe ser application/json.')
  }

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) throw new BodyError(413, 'payload_too_large', 'El body supera 1 MB.')

  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) throw new BodyError(413, 'payload_too_large', 'El body supera 1 MB.')

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BodyError(400, 'invalid_json', 'El body no es JSON válido.')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BodyError(400, 'invalid_json', 'El body debe ser un objeto JSON.')
  }
  return parsed as Record<string, unknown>
}
