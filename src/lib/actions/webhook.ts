'use server'

import { getCurrentUserProfile } from './users'
import { sendFromButton } from '@/lib/email/button'
import { toClientResult, describeError } from '@/lib/email/public'

// El envío real (SMTP o Apps Script legado, según el modo configurado en Admin → Correos) vive en
// src/lib/email. Esta acción se mantiene para el botón "Enviar email" existente: lanza un Error con
// el motivo si no se pudo enviar, y la UI lo muestra.
export async function triggerButtonWebhook(
  recordId: string,
  buttonFieldId: string
): Promise<{ success: boolean }> {
  const user = await getCurrentUserProfile()
  if (!user) throw new Error('No autenticado')

  const result = toClientResult(
    await sendFromButton({ id: user.id, email: user.email, name: user.name, role: user.role }, recordId, buttonFieldId),
    user.role
  )
  if (!result.ok && result.error) throw new Error(describeError(result.error))
  return { success: true }
}
