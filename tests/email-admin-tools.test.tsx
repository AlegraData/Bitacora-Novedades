import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString as render } from 'react-dom/server'
import { prisma } from '@/lib/prisma'
import { sendTestEmail, simulateRecord, shadowComparison, testLimiter } from '@/lib/email/admin-tools'
import { sendNovedad } from '@/lib/email/service'
import { setTransportFactory } from '@/lib/email/transport'
import { saveTemplate } from '@/lib/email/template-store'
import { TestSend, Simulate } from '@/components/email/test-tools'
import { DeliveryDetail, StatusChip } from '@/components/email/deliveries-panel'
import type { DeliveryDTO } from '@/lib/email/history'
import { resetDb, makeUser, ensureFields } from './helpers'
import { clearMailbox, getMessage, listMessages } from './mailpit'
import { viewer, makeRecord, setMode, startServer, makeWebhookButton, type TestServer } from './email-helpers'

let actor: { id: string; email: string; name: string | null }
const servers: TestServer[] = []
let savedHost: string | undefined

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  await prisma.field.deleteMany({ where: { type: 'button' } })
  await clearMailbox()
  testLimiter.reset()
  setTransportFactory(null)
  savedHost = process.env.SMTP_HOST
  const u = await makeUser('admin@alegra.com', 'ADMIN')
  actor = { id: u.id, email: u.email, name: u.name }
})
afterEach(async () => {
  setTransportFactory(null)
  if (savedHost === undefined) delete process.env.SMTP_HOST
  else process.env.SMTP_HOST = savedHost
  while (servers.length) await servers.pop()!.close()
})

test('correo de prueba: llega solo a las direcciones indicadas, con [TEST], y queda registrado y auditado', async () => {
  const rec = await makeRecord()
  const r = await sendTestEmail(actor, { addresses: 'yo@alegra.com, otro@alegra.com', recordId: rec.id })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'sent')
  assert.match(r.subject!, /^\[TEST\] Novedad \| Alegra POS - Facturación masiva$/)

  const [m] = await listMessages()
  const mail = await getMessage(m.ID)
  assert.deepEqual(mail.To.map((t) => t.Address).sort(), ['otro@alegra.com', 'yo@alegra.com'])
  assert.ok(!JSON.stringify(mail.To).includes('dest1@alegra.com'), 'nunca a los destinatarios reales de la novedad')
  assert.match(mail.HTML, /Ahora puedes facturar en lote/)

  const row = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: r.deliveryId } })
  assert.deepEqual([row.mode, row.trigger, row.channel, row.status, row.lockKey], ['test', 'test', 'admin', 'sent', null])
  assert.equal(await prisma.auditLog.count({ where: { action: 'EMAIL_TEST_SENT' } }), 1)
  // y no consume el envío real de la novedad
  await setMode('live')
  assert.equal((await sendNovedad({ recordId: rec.id, actor: viewer, channel: 'web', trigger: 'manual' })).status, 'sent')
})

test('con datos de ejemplo no necesita novedad; usa la plantilla guardada o el borrador del editor', async () => {
  const a = await sendTestEmail(actor, { addresses: 'yo@alegra.com' })
  assert.equal(a.status, 'sent')
  assert.match((await getMessage((await listMessages())[0].ID)).Subject, /Conciliación bancaria automática/)

  await saveTemplate(actor, { subject: 'GUARDADA {{titulo}}', html: '<p>guardada</p>' })
  await sendTestEmail(actor, { addresses: 'yo@alegra.com' })
  await sendTestEmail(actor, { addresses: 'yo@alegra.com', subject: 'BORRADOR {{titulo}}', html: '<p>borrador</p>' })
  const subjects = await Promise.all((await listMessages()).map(async (m) => (await getMessage(m.ID)).Subject))
  assert.ok(subjects.some((s) => s.startsWith('[TEST] GUARDADA')))
  assert.ok(subjects.some((s) => s.startsWith('[TEST] BORRADOR')))
})

test('restricciones: dominio, formato, cantidad, vacío — ninguna deja salir un correo', async () => {
  const cases: [string, RegExp][] = [
    ['externo@gmail.com', /Solo se permiten/],
    ['a@alegra.com.evil.com', /Solo se permiten/],
    ['a@evilalegra.com', /Solo se permiten/],
    ['no-es-correo', /inválidas/],
    ['a@alegra.com\r\nBcc: evil@gmail.com', /inválidas/],
    ['u1@alegra.com,u2@alegra.com,u3@alegra.com,u4@alegra.com,u5@alegra.com,u6@alegra.com', /Máximo/],
    ['', /al menos un correo/],
    ['   ', /al menos un correo/],
  ]
  for (const [addresses, re] of cases) {
    const r = await sendTestEmail(actor, { addresses })
    assert.equal(r.ok, false, addresses)
    assert.equal(r.error?.code, 'VALIDATION', addresses)
    assert.match(r.error!.message, re, addresses)
  }
  assert.equal((await listMessages()).length, 0)
  assert.equal(await prisma.emailDelivery.count(), 0)
})

test('límite por hora: el undécimo correo de prueba se rechaza', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await sendTestEmail(actor, { addresses: 'yo@alegra.com' })).status, 'sent')
  const r = await sendTestEmail(actor, { addresses: 'yo@alegra.com' })
  assert.equal(r.error?.code, 'RATE_LIMIT')
  assert.equal((await listMessages()).length, 10)
  // el límite es por administrador
  const other = await makeUser('otro-admin@alegra.com', 'ADMIN')
  assert.equal((await sendTestEmail({ id: other.id, email: other.email, name: null }, { addresses: 'yo@alegra.com' })).status, 'sent')
})

test('borrador inválido, novedad inexistente/hostil o SMTP sin configurar → error claro y nada sale', async () => {
  const bad = await sendTestEmail(actor, { addresses: 'yo@alegra.com', subject: 'x', html: '<p>{{{titulo}}}</p>' })
  assert.equal(bad.error?.code, 'TEMPLATE')
  for (const id of ['no-existe', "' OR 1=1--", String.fromCharCode(0)]) {
    assert.equal((await sendTestEmail(actor, { addresses: 'yo@alegra.com', recordId: id })).error?.code, 'NOT_FOUND', id)
  }
  delete process.env.SMTP_HOST
  const noSmtp = await sendTestEmail(actor, { addresses: 'yo@alegra.com' })
  assert.equal(noSmtp.error?.code, 'SMTP_NOT_CONFIGURED')
  assert.equal((await listMessages()).length, 0)
})

test('un fallo del SMTP en la prueba queda registrado con su motivo y detalle técnico', async () => {
  setTransportFactory(() => ({
    sendMail: async () => { throw Object.assign(new Error('x'), { code: 'EAUTH', responseCode: 535, response: '535 5.7.8 Username and Password not accepted' }) },
    verify: async () => true,
  }))
  const r = await sendTestEmail(actor, { addresses: 'yo@alegra.com' })
  assert.equal(r.ok, false)
  assert.equal(r.error?.code, 'SMTP_AUTH')
  assert.match(r.error!.detail!, /535/)
  const row = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: r.deliveryId } })
  assert.deepEqual([row.status, row.errorCode, row.lockKey], ['failed', 'SMTP_AUTH', null])
})

test('simulacro: devuelve el correo exacto de una novedad real, no envía, y funciona aunque ya esté enviada', async () => {
  const rec = await makeRecord()
  const s = await simulateRecord(actor, rec.id)
  assert.equal(s.status, 'simulated')
  assert.ok(s.html?.includes('Facturación masiva') && s.text)
  assert.equal((await listMessages()).length, 0)

  await setMode('live')
  await sendNovedad({ recordId: rec.id, actor: viewer, channel: 'web', trigger: 'manual' })
  assert.equal((await simulateRecord(actor, rec.id)).status, 'simulated')

  assert.equal((await simulateRecord(actor, 'no-existe')).error?.code, 'NOT_FOUND')
  assert.equal((await simulateRecord(actor, "' OR 1=1")).error?.code, 'NOT_FOUND')
  assert.equal((await simulateRecord(actor, undefined)).error?.code, 'NOT_FOUND')
  const incomplete = await makeRecord({ responsables: [] })
  assert.deepEqual((await simulateRecord(actor, incomplete.id)).error?.missingFields, ['Responsables'])
})

test('comparación en sombra: distingue OK, fallo y respuestas sospechosas del Apps Script', async () => {
  await setMode('shadow')
  const ok = await startServer({ status: 200, body: '{"status":"success"}' })
  servers.push(ok)
  const btn = await makeWebhookButton(ok.url)

  const a = await makeRecord({ titulo: 'A OK' })
  await sendNovedad({ recordId: a.id, actor: viewer, channel: 'web', trigger: 'manual' })

  ok.respond.body = '<html>Error de script</html>' // 200 pero sin "success": puede haber fallado por dentro
  const b = await makeRecord({ titulo: 'B sospechosa' })
  await sendNovedad({ recordId: b.id, actor: viewer, channel: 'web', trigger: 'manual' })

  ok.respond.status = 500
  const c = await makeRecord({ titulo: 'C falla' })
  await sendNovedad({ recordId: c.id, actor: viewer, channel: 'web', trigger: 'manual' })

  const cmp = await shadowComparison()
  assert.equal(cmp.total, 3)
  assert.equal(cmp.legacyOk, 1)
  assert.equal(cmp.legacyFailed, 1)
  assert.equal(cmp.suspicious, 1)
  const byId = new Map(cmp.rows.map((r) => [r.recordId, r]))
  assert.equal(byId.get(a.id)!.legacy!.suspicious, false)
  assert.equal(byId.get(b.id)!.legacy!.suspicious, true)
  assert.equal(byId.get(c.id)!.legacy!.status, 'failed')
  assert.ok(byId.get(a.id)!.simulated, 'la app dejó constancia de lo que habría enviado')
  assert.ok(byId.get(c.id)!.simulated === null, 'si el script falló no hay simulacro paralelo')
  await prisma.field.delete({ where: { id: btn.id } })
})

test('pantallas: prueba, simulacro y detalle del envío', () => {
  const novedades = [{ id: 'r1', titulo: 'Mi novedad', tipo: 'Novedad', createdAt: '2026-10-20T00:00:00Z' }]
  const t = render(<TestSend novedades={novedades} defaults={{ addresses: 'yo@alegra.com', domains: ['alegra.com'], max: 5 }} />).replace(/<!-- -->/g, '')
  for (const x of ['Enviar correo de prueba', '@alegra.com', 'máx. 5', '[TEST]', 'Datos de ejemplo', 'Mi novedad (Novedad)', 'yo@alegra.com']) assert.ok(t.includes(x), x)
  const s = render(<Simulate novedades={novedades} />).replace(/<!-- -->/g, '')
  assert.ok(s.includes('No envía nada ni marca la novedad como comunicada') && s.includes('Simular envío'))

  const d: DeliveryDTO = {
    id: 'd1', recordId: 'r1', mode: 'live', status: 'failed', subject: 'Asunto', recipients: ['a@alegra.com'], rejected: [], channel: 'web', trigger: 'button',
    triggeredByEmail: 'ana@alegra.com', triggeredByName: 'Ana', resendReason: null, errorCode: 'SMTP_AUTH', errorMessage: 'No se pudo autenticar', chatStatus: null,
    createdAt: '2026-10-20T10:00:00Z', finishedAt: '2026-10-20T10:00:01Z', durationMs: 900, errorDetail: '535 detalle', html: '<p>correo</p>',
  }
  const detail = render(<DeliveryDetail d={d} onClose={() => {}} />).replace(/<!-- -->/g, '')
  for (const x of ['Detalle del envío', 'No se pudo autenticar con el servidor de correo', '535 detalle', 'ana@alegra.com', '900 ms', 'sandbox=""']) assert.ok(detail.includes(x), x)
  assert.ok(render(<StatusChip status="sent" />).includes('Enviado'))
})
