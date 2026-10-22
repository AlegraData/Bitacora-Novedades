import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma'
import { addAuditLog } from '@/lib/actions/audit'
import { getSettings } from './settings'
import { resolveChatUsers, type ResolvedUser } from './it-hub'
import type { ChatMention } from './chat'
import type { NotifyRecipient } from './recipients'

/** Guarda en la configuración los IDs resueltos (así no se vuelve a consultar el IT Hub en cada envío). */
async function persist(found: { email: string; id: string; fullName?: string }[]) {
  const settings = await getSettings()
  const byEmail = new Map(found.map((f) => [f.email, f]))
  const merged = settings.recipients.map((r) => {
    const hit = byEmail.get(r.email)
    if (!hit || r.chatUserId) return r
    return { ...r, chatUserId: hit.id, ...(r.name || !hit.fullName ? {} : { name: hit.fullName }) }
  })
  await prisma.emailSettings.update({ where: { id: 'singleton' }, data: { notifyRecipients: merged as unknown as Prisma.InputJsonValue } })
  await addAuditLog({
    userEmail: 'sistema',
    userName: 'Bitácora (resolución automática)',
    action: 'EMAIL_CHAT_IDS_RESOLVED',
    details: { count: found.length },
  }).catch(() => {})
}

/**
 * Completa el ID de Chat de los destinatarios que no lo tienen consultando el IT Hub y lo guarda.
 * Nunca lanza: si el IT Hub falla, esa persona se nombra en texto (sin notificar) y el envío sigue.
 */
export async function ensureChatIds(recipients: NotifyRecipient[]): Promise<{ recipients: NotifyRecipient[]; unresolved: ResolvedUser[] }> {
  const missing = recipients.filter((r) => !r.chatUserId)
  if (missing.length === 0) return { recipients, unresolved: [] }

  let results: ResolvedUser[]
  try {
    results = await resolveChatUsers(missing.map((r) => r.email))
  } catch {
    return { recipients, unresolved: missing.map((r) => ({ email: r.email, error: 'No se pudo consultar el IT Hub.' })) }
  }
  const found = results.filter((r): r is ResolvedUser & { id: string } => Boolean(r.id))
  if (found.length > 0) {
    try {
      await persist(found)
    } catch (e) {
      console.error('[chat] no se pudieron guardar los IDs de Chat:', e)
    }
  }
  const ids = new Map(found.map((f) => [f.email, f]))
  return {
    recipients: recipients.map((r) => (r.chatUserId ? r : ids.has(r.email) ? { ...r, chatUserId: ids.get(r.email)!.id } : r)),
    unresolved: results.filter((r) => !r.id),
  }
}

export function toMentions(recipients: NotifyRecipient[]): ChatMention[] {
  return recipients.map((r) => ({ name: r.name ?? r.email, chatUserId: r.chatUserId }))
}
