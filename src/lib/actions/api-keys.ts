'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth-utils'
import {
  createKeyFor,
  updateKeyFor,
  revokeKeyFor,
  usageFor,
  listMine,
  listAll,
  type ManageActor,
  type ActionResult,
} from '@/lib/api/manage'
import type { ApiKeyDTO, ApiKeyUsage, CreateApiKeyInput, UpdateApiKeyInput } from '@/lib/api/keys'

// El actor sale siempre de la sesión del servidor: ni el rol ni el email se aceptan del cliente.
async function currentActor(): Promise<ManageActor> {
  const u = await requireUser()
  return { id: u.id, email: u.email, name: u.name, role: u.role }
}

function refresh() {
  revalidatePath('/admin')
  revalidatePath('/api-tokens')
}

export async function getMyApiKeys(): Promise<ApiKeyDTO[]> {
  return listMine(await currentActor())
}

/** Solo ADMIN. */
export async function getAllApiKeys(): Promise<ApiKeyDTO[]> {
  return listAll(await currentActor())
}

export async function createApiKeyAction(input: CreateApiKeyInput): Promise<ActionResult<{ token: string; key: ApiKeyDTO }>> {
  const res = await createKeyFor(await currentActor(), input)
  if (res.ok) refresh()
  return res
}

export async function updateApiKeyAction(id: string, input: UpdateApiKeyInput): Promise<ActionResult<ApiKeyDTO>> {
  const res = await updateKeyFor(await currentActor(), id, input)
  if (res.ok) refresh()
  return res
}

export async function revokeApiKeyAction(id: string): Promise<ActionResult> {
  const res = await revokeKeyFor(await currentActor(), id)
  if (res.ok) refresh()
  return res
}

export async function getApiKeyUsageAction(id: string): Promise<ActionResult<ApiKeyUsage>> {
  return usageFor(await currentActor(), id)
}
