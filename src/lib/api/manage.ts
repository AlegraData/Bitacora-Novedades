import { addAuditLog } from '@/lib/actions/audit'
import {
  ApiKeyError,
  createApiKey,
  getApiKeyUsage,
  listApiKeys,
  revokeApiKey,
  updateApiKey,
  type Actor,
  type ApiKeyDTO,
  type ApiKeyUsage,
  type CreateApiKeyInput,
  type UpdateApiKeyInput,
} from './keys'

/** Quién ejecuta la acción. Lo arma siempre el servidor (sesión), nunca el cliente. */
export interface ManageActor extends Actor {
  id: string
  name: string | null
}

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string; code: string }

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    if (e instanceof ApiKeyError) return { ok: false, error: e.message, code: e.code }
    console.error('[api-keys] error inesperado:', e)
    return { ok: false, error: 'Error inesperado. Intenta de nuevo.', code: 'INTERNAL' }
  }
}

function audit(actor: ManageActor, action: string, key: ApiKeyDTO, extra: Record<string, unknown> = {}) {
  return addAuditLog({
    userId: actor.id,
    userEmail: actor.email,
    userName: actor.name ?? actor.email,
    action,
    // Nunca se registra el token ni su hash: solo metadatos.
    details: { keyId: key.id, keyName: key.name, keyOwner: key.ownerEmail, scopes: key.scopes, ...extra },
  }).catch((e) => console.error('[api-keys] no se pudo auditar:', e))
}

export function createKeyFor(actor: ManageActor, input: CreateApiKeyInput) {
  return run(async () => {
    const created = await createApiKey(actor, input)
    await audit(actor, 'API_KEY_CREATED', created.key, { expiresAt: created.key.expiresAt })
    return created
  })
}

export function updateKeyFor(actor: ManageActor, id: string, input: UpdateApiKeyInput) {
  return run(async () => {
    const key = await updateApiKey(id, actor, input)
    await audit(actor, 'API_KEY_UPDATED', key, { changed: Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined) })
    return key
  })
}

export function revokeKeyFor(actor: ManageActor, id: string) {
  return run(async () => {
    const before = (await listApiKeys()).find((k) => k.id === id)
    await revokeApiKey(id, actor)
    if (before) await audit(actor, 'API_KEY_REVOKED', before)
    return null
  })
}

export function usageFor(actor: ManageActor, id: string): Promise<ActionResult<ApiKeyUsage>> {
  return run(() => getApiKeyUsage(id, actor))
}

export function listMine(actor: ManageActor) {
  return listApiKeys({ ownerEmail: actor.email })
}

/** Solo ADMIN: todos los tokens de la organización. */
export function listAll(actor: ManageActor) {
  if (actor.role !== 'ADMIN') throw new ApiKeyError('FORBIDDEN', 'Solo un ADMIN puede ver todos los tokens.')
  return listApiKeys()
}
