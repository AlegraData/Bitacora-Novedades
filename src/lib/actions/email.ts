'use server'

import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth-utils'
import { sendNovedad, type SendActor, type SendResult } from '@/lib/email/service'
import { sendFromButton } from '@/lib/email/button'
import { toClientResult } from '@/lib/email/public'
import { listDeliveries, type DeliveryDTO } from '@/lib/email/history'
import { getSettings, MODE_LABELS, type DeliveryMode } from '@/lib/email/settings'

// El actor sale siempre de la sesión del servidor: ni el rol ni el email se aceptan del cliente.
async function actor(): Promise<SendActor & { id: string }> {
  const u = await requireUser()
  return { id: u.id, email: u.email, name: u.name, role: u.role }
}

/**
 * Botón "Enviar email" / "Simular" / "Reenviar". Devuelve siempre un resultado con el motivo
 * (nunca lanza por errores de negocio) para mostrarlo en pantalla.
 */
export async function sendRecordEmail(
  recordId: string,
  opts: { simulate?: boolean; resendReason?: string } = {}
): Promise<SendResult> {
  const user = await actor()
  const resend = typeof opts.resendReason === 'string' ? { reason: opts.resendReason } : undefined
  const simulate = opts.simulate === true

  const button = await prisma.field.findFirst({ where: { type: 'button' }, orderBy: { order: 'asc' } })
  const raw = button
    ? await sendFromButton(user, recordId, button.id, { simulate, resend })
    : await sendNovedad({ recordId, actor: user, channel: 'web', trigger: 'button', simulate, resend })

  // El correo renderizado solo se devuelve para el simulacro (vista previa).
  return toClientResult(raw, user.role, { html: simulate })
}

export async function getRecordEmailHistory(recordId: string): Promise<DeliveryDTO[]> {
  const user = await actor()
  return (await listDeliveries(user.role, { recordId, limit: 30 })).deliveries
}

/** Modo de envío vigente (para avisar en pantalla cuando no es "en vivo"). */
export async function getEmailModeInfo(): Promise<{ mode: DeliveryMode; label: string }> {
  await requireUser()
  const { mode } = await getSettings()
  return { mode, label: MODE_LABELS[mode] }
}
