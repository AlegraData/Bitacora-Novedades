import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma'
import type { ButtonConfig, RecordData } from '@/types'
import { sendNovedad, type SendActor, type SendResult } from './service'

/**
 * Lo que hace el botón "Enviar email": dispara el envío y, si salió de verdad, deja la fecha
 * en el campo del botón y una línea en su campo de bitácora (igual que antes).
 */
export async function sendFromButton(
  actor: SendActor,
  recordId: string,
  buttonFieldId: string,
  opts: { simulate?: boolean; resend?: { reason: string } } = {}
): Promise<SendResult> {
  const field = await prisma.field.findUnique({ where: { id: buttonFieldId } })
  if (!field || field.type !== 'button') {
    return { ok: false, status: 'failed', error: { code: 'NOT_FOUND', message: 'Campo botón no encontrado.' } }
  }

  const result = await sendNovedad({ recordId, actor, channel: 'web', trigger: 'button', ...opts })

  // Las pruebas (modo test) y los simulacros no cuentan como "comunicado".
  const communicated = result.status === 'sent' && result.mode !== 'test'
  if (communicated) {
    const record = await prisma.record.findUnique({ where: { id: recordId } })
    if (record) {
      const config = field.config as ButtonConfig | null
      const data = { ...(record.data as RecordData) }
      data[buttonFieldId] = new Date().toISOString()
      if (config?.logFieldId) {
        const existing = String(data[config.logFieldId] ?? '')
        const entry = `${new Date().toLocaleString('es-CO')} → ejecutado por ${actor.email}`
        data[config.logFieldId] = existing ? `${existing}\n${entry}` : entry
      }
      await prisma.record.update({ where: { id: recordId }, data: { data: data as unknown as Prisma.InputJsonValue } })
    }
  }
  return result
}
