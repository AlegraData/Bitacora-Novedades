import { CHAT_USER_ID_RE } from './recipients'

// Cliente del IT Hub de Alegra: traduce un correo al ID de usuario de Google (el de las menciones <users/ID>
// de Chat). Mismo endpoint que usa el Apps Script (mentionGoogleChat): GET /api/devtools/google-user?email=.
// La llave (scope google-user) vive como secreto de Cloud Run; nunca se imprime ni se devuelve.

export interface ResolvedUser {
  email: string
  id?: string
  fullName?: string
  /** Por qué no se pudo resolver (mensaje legible, sin datos sensibles). */
  error?: string
}

function config(): { url: string; key: string } | null {
  const url = process.env.IT_HUB_URL?.trim().replace(/\/+$/, '')
  const key = process.env.IT_HUB_API_KEY?.trim()
  if (!url || !key) return null
  try {
    const u = new URL(url)
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null
  } catch {
    return null
  }
  return { url, key }
}

export function itHubConfigured(): boolean {
  return config() !== null
}

async function resolveOne(cfg: { url: string; key: string }, email: string): Promise<ResolvedUser> {
  try {
    const res = await fetch(`${cfg.url}/api/devtools/google-user?email=${encodeURIComponent(email)}`, {
      headers: { 'X-Api-Key': cfg.key },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401 || res.status === 403) return { email, error: 'El IT Hub rechazó la llave de la Bitácora (revisa IT_HUB_API_KEY).' }
    if (res.status === 404) return { email, error: 'No existe en el directorio de Google Workspace.' }
    if (!res.ok) return { email, error: `El IT Hub respondió ${res.status}.` }

    const body = (await res.json().catch(() => null)) as { id?: unknown; fullName?: unknown; error?: unknown } | null
    const id = body && typeof body.id === 'string' ? body.id.trim() : ''
    if (!body || body.error || !CHAT_USER_ID_RE.test(id)) return { email, error: 'El IT Hub no devolvió un ID válido.' }
    return { email, id, ...(typeof body.fullName === 'string' ? { fullName: body.fullName.slice(0, 120) } : {}) }
  } catch (e) {
    return { email, error: e instanceof Error && e.name === 'TimeoutError' ? 'El IT Hub no respondió a tiempo.' : 'No se pudo conectar con el IT Hub.' }
  }
}

/** Resuelve varios correos (máx. 20) con concurrencia limitada. Nunca lanza: cada resultado trae su `error` si falló. */
export async function resolveChatUsers(emails: string[]): Promise<ResolvedUser[]> {
  const cfg = config()
  const list = Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))).slice(0, 20)
  if (!cfg) return list.map((email) => ({ email, error: 'El IT Hub no está configurado (IT_HUB_URL / IT_HUB_API_KEY).' }))

  const out: ResolvedUser[] = new Array(list.length)
  let next = 0
  const worker = async () => {
    while (next < list.length) {
      const i = next++
      out[i] = await resolveOne(cfg, list[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker))
  return out
}
