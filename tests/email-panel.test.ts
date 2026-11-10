import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { listPending, resendFromPanel } from '@/lib/email/panel'
import { saveRule } from '@/lib/email/rules'
import { sendNovedad } from '@/lib/email/service'
import { DEFAULT_REQUIRED_FIELDS } from '@/lib/email/communication'
import { resetDb, ensureFields, makeUser } from './helpers'
import { clearMailbox, listMessages } from './mailpit'
import { viewer, makeRecord, setMode } from './email-helpers'

const tomas = { id: '', email: 'tomas.lopera@alegra.com', name: 'Tomas' }

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  tomas.id = (await makeUser('tomas.lopera@alegra.com', 'ADMIN')).id
  await clearMailbox()
  await setMode('live')
})

test('pendientes: incompletas con el campo que falta; las comunicadas y las de tipo deshabilitado no salen', async () => {
  const incompleta = await makeRecord({ tipo: 'Novedad', titulo: 'Incompleta', breveDescripcion: undefined })
  const enviada = await makeRecord({ tipo: 'Novedad', titulo: 'Enviada' })
  await sendNovedad({ recordId: enviada.id, actor: viewer, channel: 'web', trigger: 'auto' })
  await makeRecord({ tipo: 'Mejora', titulo: 'Deshabilitada', breveDescripcion: undefined })

  const pending = await listPending()
  assert.deepEqual(pending.map((p) => p.id), [incompleta.id])
  assert.deepEqual([pending[0].state, pending[0].missing, pending[0].mode], ['incomplete', ['Breve descripción'], 'AUTO'])
})

test('pendientes: un tipo MANUAL completo aparece como «ready» (a la espera del envío manual)', async () => {
  await saveRule(tomas, { tipo: 'Mejora', mode: 'MANUAL', requiredFields: DEFAULT_REQUIRED_FIELDS })
  const r = await makeRecord({ tipo: 'Mejora', titulo: 'Para enviar a mano' })
  const [p] = await listPending()
  assert.deepEqual([p.id, p.state, p.mode], [r.id, 'ready', 'MANUAL'])
  assert.deepEqual((await listPending({ tipo: 'Novedad' })), [])
})

test('reejecutar desde el panel: exige motivo, envía, queda en el historial con el motivo y en la auditoría', async () => {
  const r = await makeRecord({ tipo: 'Novedad' })
  await sendNovedad({ recordId: r.id, actor: viewer, channel: 'web', trigger: 'auto' })
  const sinMotivo = await resendFromPanel(tomas, r.id, 'corto')
  assert.equal(sinMotivo.error?.code, 'VALIDATION')

  const ok = await resendFromPanel(tomas, r.id, 'El correo anterior no llegó al grupo')
  assert.equal(ok.status, 'sent')
  const last = await prisma.emailDelivery.findFirstOrThrow({ where: { recordId: r.id, status: 'sent' }, orderBy: { createdAt: 'desc' } })
  assert.equal(last.resendReason, 'El correo anterior no llegó al grupo')
  assert.equal((await listMessages()).length, 2)
  assert.equal(await prisma.auditLog.count({ where: { recordId: r.id, action: 'EMAIL_RESEND' } }), 1)
})
