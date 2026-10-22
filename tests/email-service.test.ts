import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { sendNovedad, STALE_SENDING_MS, type SendOptions } from '@/lib/email/service'
import { setTransportFactory } from '@/lib/email/transport'
import { saveTemplate } from '@/lib/email/template-store'
import { resetDb, ensureFields, makeUser } from './helpers'
import { clearMailbox, getMessage, listMessages } from './mailpit'
import { admin, viewer, makeRecord, setMode, startServer, makeWebhookButton, type TestServer } from './email-helpers'

const send = (recordId: string, over: Partial<SendOptions> = {}) =>
  sendNovedad({ recordId, actor: viewer, channel: 'web', trigger: 'manual', ...over })

const servers: TestServer[] = []
const saved: Record<string, string | undefined> = {}

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  await prisma.field.deleteMany({ where: { type: 'button' } })
  await clearMailbox()
  setTransportFactory(null)
  saved.SMTP_HOST = process.env.SMTP_HOST
  saved.SMTP_PASS = process.env.SMTP_PASS
  saved.CHAT = process.env.PMKT_CHAT_WEBHOOK_URL
  delete process.env.PMKT_CHAT_WEBHOOK_URL
  await setMode('live')
})

afterEach(async () => {
  setTransportFactory(null)
  for (const [k, v] of [['SMTP_HOST', saved.SMTP_HOST], ['SMTP_PASS', saved.SMTP_PASS], ['PMKT_CHAT_WEBHOOK_URL', saved.CHAT]] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  while (servers.length) await servers.pop()!.close()
})

const server = async (init?: { status: number; body: string }) => {
  const s = await startServer(init)
  servers.push(s)
  return s
}

test('modo live: envía por SMTP a los destinatarios de la notificación, registra y audita', async () => {
  const r = await makeRecord()
  const res = await send(r.id)
  assert.equal(res.ok, true)
  assert.equal(res.status, 'sent')
  assert.equal(res.mode, 'live')
  assert.deepEqual(res.recipients?.sort(), ['cristian.albornoz@alegra.com', 'cristian.bautista@alegra.com', 'valentina.garcia@alegra.com'])

  const [m] = await listMessages()
  const mail = await getMessage(m.ID)
  assert.equal(mail.Subject, 'Novedad | Alegra POS - Facturación masiva')
  assert.deepEqual(mail.To.map((t) => t.Address).sort(), ['cristian.albornoz@alegra.com', 'cristian.bautista@alegra.com', 'valentina.garcia@alegra.com'])
  assert.match(mail.HTML, /Ahora puedes facturar en lote\./)

  const d = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: res.deliveryId } })
  assert.equal(d.status, 'sent')
  assert.equal(d.lockKey, `novedad:${r.id}`)
  assert.equal(d.channel, 'web')
  assert.ok(d.html?.includes('Facturación masiva'))
  assert.equal(await prisma.auditLog.count({ where: { action: 'EMAIL_SENT', recordId: r.id } }), 1)
})

test('duplicados: el segundo envío manual falla con el detalle del anterior; el auto se omite; no sale otro correo', async () => {
  const r = await makeRecord()
  await send(r.id)
  const again = await send(r.id)
  assert.equal(again.ok, false)
  assert.equal(again.error?.code, 'DUPLICATE')
  assert.equal(again.error?.previous?.by, 'viewer@alegra.com')
  const auto = await send(r.id, { trigger: 'auto' })
  assert.equal(auto.status, 'skipped')
  assert.equal(auto.skippedReason, 'ya_enviado')
  assert.equal((await listMessages()).length, 1)
})

test('concurrencia: 10 envíos simultáneos producen exactamente 1 correo', async () => {
  const r = await makeRecord()
  const results = await Promise.all(Array.from({ length: 10 }, () => send(r.id)))
  assert.equal(results.filter((x) => x.status === 'sent').length, 1)
  for (const x of results.filter((x) => x.status !== 'sent')) assert.ok(['DUPLICATE', 'IN_PROGRESS'].includes(x.error!.code), x.error?.code)
  assert.equal((await listMessages()).length, 1)
  assert.equal(await prisma.emailDelivery.count({ where: { status: 'sent' } }), 1)
})

test('un fallo de SMTP se reporta con motivo, libera el lock y permite reintentar', async () => {
  const r = await makeRecord()
  setTransportFactory(() => ({
    sendMail: async () => { throw Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535, response: '535 Username and Password not accepted' }) },
    verify: async () => true,
  }))
  const bad = await send(r.id)
  assert.equal(bad.ok, false)
  assert.equal(bad.error?.code, 'SMTP_AUTH')
  assert.match(bad.error!.detail!, /535/)
  const row = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: bad.deliveryId } })
  assert.equal(row.status, 'failed')
  assert.equal(row.lockKey, null, 'el lock se libera al fallar')
  assert.equal(row.errorCode, 'SMTP_AUTH')

  setTransportFactory(null)
  const ok = await send(r.id)
  assert.equal(ok.status, 'sent')
  assert.equal((await listMessages()).length, 1)
})

test('reenvío: solo ADMIN y con motivo; el envío anterior queda en el historial', async () => {
  const r = await makeRecord()
  await send(r.id)

  const denied = await send(r.id, { resend: { reason: 'corrección' } })
  assert.equal(denied.error?.code, 'FORBIDDEN')
  const noReason = await send(r.id, { actor: admin, resend: { reason: '  ' } })
  assert.equal(noReason.error?.code, 'VALIDATION')
  assert.equal((await listMessages()).length, 1)

  const ok = await send(r.id, { actor: admin, resend: { reason: 'Corrección de la fecha' } })
  assert.equal(ok.status, 'sent')
  assert.equal((await listMessages()).length, 2)
  assert.equal(await prisma.emailDelivery.count({ where: { recordId: r.id, status: 'sent' } }), 2)
  assert.equal(await prisma.emailDelivery.count({ where: { lockKey: `novedad:${r.id}` } }), 1, 'solo el último tiene el lock')
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'EMAIL_RESEND' } })
  assert.equal((audit.details as Record<string, unknown>).reason, 'Corrección de la fecha')
  // y después de reenviar, otro intento sin permiso sigue bloqueado
  assert.equal((await send(r.id)).error?.code, 'DUPLICATE')
})

test('validación: manual lista exactamente qué falta; auto se omite en silencio; nunca sale correo ni se toma lock', async () => {
  const r = await makeRecord({ responsables: [], fechaProduccion: undefined })
  const manual = await send(r.id)
  assert.equal(manual.error?.code, 'VALIDATION')
  assert.deepEqual(manual.error?.missingFields?.sort(), ['Fecha real de producción', 'Responsables'])
  const auto = await send(r.id, { trigger: 'auto' })
  assert.equal(auto.status, 'skipped')
  assert.equal(auto.skippedReason, 'campos_incompletos')
  assert.equal(auto.missingFields?.length, 2)
  assert.equal((await listMessages()).length, 0)
  assert.equal(await prisma.emailDelivery.count(), 0)
})

test('«Correos a comunicar» (vacío, inválido o con otros) es informativo: no bloquea ni cambia a quién se envía', async () => {
  for (const correos of [[], ['mal-escrito'], ['ok@alegra.com', 'tm-alegra@alegra.com']]) {
    await clearMailbox()
    await prisma.emailDelivery.deleteMany()
    const r = await makeRecord({ correosAComunicar: correos })
    const res = await send(r.id)
    assert.equal(res.status, 'sent', JSON.stringify(correos))
    assert.deepEqual(res.recipients?.sort(), ['cristian.albornoz@alegra.com', 'cristian.bautista@alegra.com', 'valentina.garcia@alegra.com'])
    assert.equal(res.warnings?.length ?? 0, 0)
  }
})

test('todos los tipos se comunican (TMDIAPD-56): ya no hay tipos que no apliquen', async () => {
  const r = await makeRecord({ tipo: 'Mejora técnica' })
  assert.equal((await send(r.id, { trigger: 'auto' })).status, 'sent')
  assert.equal((await send('no-existe')).error?.code, 'NOT_FOUND')
})

test('el auto-envío no toca registros anteriores a la fecha de corte', async () => {
  const r = await makeRecord({}, new Date('2026-09-01T00:00:00Z'))
  assert.equal((await send(r.id, { trigger: 'auto' })).skippedReason, 'registro_anterior_al_cutover')
  assert.equal((await send(r.id)).status, 'sent', 'manual sí puede')
})

test('simulacro: renderiza el correo exacto sin enviar, sin lock y aun sin SMTP configurado', async () => {
  const r = await makeRecord()
  delete process.env.SMTP_HOST
  const sim = await send(r.id, { simulate: true })
  assert.equal(sim.ok, true)
  assert.equal(sim.status, 'simulated')
  assert.equal(sim.subject, 'Novedad | Alegra POS - Facturación masiva')
  assert.ok(sim.html?.includes('Ahora puedes facturar en lote.'))
  assert.equal((await listMessages()).length, 0)
  const row = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: sim.deliveryId } })
  assert.equal(row.lockKey, null)
  assert.equal(row.status, 'simulated')

  // el simulacro no bloquea el envío real posterior, y se puede simular aunque ya esté enviado
  process.env.SMTP_HOST = 'localhost'
  assert.equal((await send(r.id)).status, 'sent')
  assert.equal((await send(r.id, { simulate: true })).status, 'simulated')
})

test('simulacro con datos incompletos explica qué falta (no inventa un correo)', async () => {
  const r = await makeRecord({ breveDescripcion: undefined })
  const sim = await send(r.id, { simulate: true })
  assert.equal(sim.error?.code, 'VALIDATION')
  assert.deepEqual(sim.error?.missingFields, ['Breve descripción'])
})

test('modo live sin SMTP configurado: error claro y nada queda bloqueado', async () => {
  const r = await makeRecord()
  delete process.env.SMTP_HOST
  const res = await send(r.id)
  assert.equal(res.error?.code, 'SMTP_NOT_CONFIGURED')
  assert.match(res.error!.detail!, /SMTP_HOST/)
  assert.equal(await prisma.emailDelivery.count(), 0)
  process.env.SMTP_HOST = 'localhost'
  assert.equal((await send(r.id)).status, 'sent')
})

test('modo test: nunca llega a los destinatarios reales; asunto [TEST]; sin lock para manuales', async () => {
  await setMode('test', { testRecipients: ['yo@alegra.com'] })
  const r = await makeRecord()
  const a = await send(r.id)
  const b = await send(r.id)
  assert.equal(a.status, 'sent')
  assert.equal(b.status, 'sent', 'las pruebas manuales se pueden repetir')
  const msgs = await listMessages()
  assert.equal(msgs.length, 2)
  for (const m of msgs) {
    const mail = await getMessage(m.ID)
    assert.deepEqual(mail.To.map((t) => t.Address), ['yo@alegra.com'])
    assert.match(mail.Subject, /^\[TEST\] Novedad \|/)
  }
  // en test no se consume el lock real: el envío en vivo posterior sí sale
  await setMode('live')
  assert.equal((await send(r.id)).status, 'sent')
})

test('modo test automático: una sola prueba por registro (no un correo por cada guardado)', async () => {
  await setMode('test', { testRecipients: ['yo@alegra.com'] })
  const r = await makeRecord()
  assert.equal((await send(r.id, { trigger: 'auto' })).status, 'sent')
  assert.equal((await send(r.id, { trigger: 'auto' })).skippedReason, 'prueba_ya_enviada')
  assert.equal((await listMessages()).length, 1)
})

test('modo test sin correos de prueba → MODE_CONFIG', async () => {
  await setMode('test')
  const r = await makeRecord()
  assert.equal((await send(r.id)).error?.code, 'MODE_CONFIG')
  assert.equal((await listMessages()).length, 0)
})

test('modo webhook: POST al Apps Script, se guarda su respuesta y no sale correo por SMTP', async () => {
  const hook = await server()
  await makeWebhookButton(hook.url)
  await setMode('webhook')
  const r = await makeRecord()
  const res = await send(r.id)
  assert.equal(res.status, 'sent')
  assert.equal(res.mode, 'webhook')
  assert.equal(hook.requests.length, 1)
  const body = JSON.parse(hook.requests[0].body)
  assert.equal(body.recordId, r.id)
  assert.equal(body.data['Título'], 'Facturación masiva')
  assert.equal((await listMessages()).length, 0)
  const d = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: res.deliveryId } })
  assert.match(d.legacyResponse!, /^200 .*success/)
  assert.equal((await send(r.id)).error?.code, 'DUPLICATE')
})

test('modo webhook: error HTTP del Apps Script → fallo con motivo y lock liberado; sin botón → MODE_CONFIG', async () => {
  await setMode('webhook')
  const r = await makeRecord()
  assert.equal((await send(r.id)).error?.code, 'MODE_CONFIG')

  const hook = await server({ status: 500, body: 'boom' })
  await makeWebhookButton(hook.url)
  const res = await send(r.id)
  assert.equal(res.error?.code, 'WEBHOOK')
  assert.match(res.error!.detail!, /500/)
  assert.equal((await prisma.emailDelivery.findUniqueOrThrow({ where: { id: res.deliveryId } })).lockKey, null)
  hook.respond.status = 200
  assert.equal((await send(r.id)).status, 'sent')
})

test('modo sombra: el Apps Script envía de verdad y la app deja el simulacro para comparar', async () => {
  const hook = await server()
  await makeWebhookButton(hook.url)
  await setMode('shadow')
  const r = await makeRecord()
  const res = await send(r.id)
  assert.equal(res.status, 'sent')
  assert.equal(hook.requests.length, 1)
  assert.equal((await listMessages()).length, 0, 'la app NO envía por SMTP en sombra')
  const rows = await prisma.emailDelivery.findMany({ where: { recordId: r.id }, orderBy: { createdAt: 'asc' } })
  assert.deepEqual(rows.map((x) => [x.mode, x.status]), [['shadow', 'sent'], ['shadow', 'simulated']])
  assert.ok(rows[1].html?.includes('Facturación masiva'))
  assert.equal(rows[1].lockKey, null)
})

test('Chat: en vivo la app publica la tarjeta; si falla no tumba el correo; en webhook/shadow no publica', async () => {
  const chat = await server()
  process.env.PMKT_CHAT_WEBHOOK_URL = chat.url
  const r = await makeRecord()
  const res = await send(r.id)
  assert.equal(res.status, 'sent')
  assert.equal(res.chat, 'sent')
  const card = JSON.parse(chat.requests[0].body)
  const text = card.cardsV2[0].card.sections[0].widgets[0].textParagraph.text
  assert.match(text, /ana@alegra\.com/)
  assert.match(text, /Facturación masiva/)
  assert.equal(card.cardsV2[0].card.sections[1].widgets[0].buttonList.buttons[0].onClick.openLink.url, 'https://bitacora.test/app?record=' + r.id)

  chat.respond.status = 500
  const r2 = await makeRecord({ titulo: 'Otra' })
  const res2 = await send(r2.id)
  assert.equal(res2.status, 'sent', 'el correo salió aunque Chat falló')
  assert.equal(res2.chat, 'failed')
  const d = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: res2.deliveryId } })
  assert.equal(d.chatStatus, 'failed')
  assert.ok(!d.chatError!.includes('key='), 'el error de Chat no incluye la URL con key/token')

  chat.requests.length = 0
  const hook = await server()
  await makeWebhookButton(hook.url)
  await setMode('webhook')
  await send((await makeRecord({ titulo: 'Legado' })).id)
  assert.equal(chat.requests.length, 0)
})

test('Chat: el texto de la tarjeta escapa HTML de los datos', async () => {
  const chat = await server()
  process.env.PMKT_CHAT_WEBHOOK_URL = chat.url
  const r = await makeRecord({ titulo: '<b>inyectado</b>' })
  await send(r.id)
  const text = JSON.parse(chat.requests[0].body).cardsV2[0].card.sections[0].widgets[0].textParagraph.text
  assert.ok(!text.includes('<b>inyectado</b>'))
  assert.ok(text.includes('&lt;b&gt;inyectado&lt;/b&gt;'))
})

test('Chat: solo se acepta chat.googleapis.com (o localhost en tests)', async () => {
  process.env.PMKT_CHAT_WEBHOOK_URL = 'https://evil.example.com/hook'
  const r = await makeRecord()
  const res = await send(r.id)
  assert.equal(res.chat, 'failed')
  assert.equal(res.status, 'sent')
})

test('registros ya comunicados con la versión anterior (NOTIFIED_PMKT) cuentan como enviados', async () => {
  const r = await makeRecord()
  await prisma.auditLog.create({ data: { userEmail: 'ana@alegra.com', userName: 'Ana', action: 'NOTIFIED_PMKT', recordId: r.id } })
  const dup = await send(r.id)
  assert.equal(dup.error?.code, 'DUPLICATE')
  assert.equal((await send(r.id, { trigger: 'auto' })).skippedReason, 'ya_enviado')
  assert.equal((await listMessages()).length, 0)
  // un ADMIN sí puede reenviarlo
  assert.equal((await send(r.id, { actor: admin, resend: { reason: 'reenvío tras migración' } })).status, 'sent')
})

test('envío "enviando" que quedó colgado más de 5 min se recupera solo', async () => {
  const r = await makeRecord()
  await prisma.emailDelivery.create({
    data: {
      recordId: r.id, mode: 'live', status: 'sending', lockKey: `novedad:${r.id}`, channel: 'web', trigger: 'manual',
      triggeredByEmail: 'x@alegra.com', createdAt: new Date(Date.now() - STALE_SENDING_MS - 1000),
    },
  })
  assert.equal((await send(r.id)).status, 'sent')
  const old = await prisma.emailDelivery.findFirstOrThrow({ where: { status: 'failed' } })
  assert.equal(old.lockKey, null)

  // uno reciente sí cuenta como en curso
  const r2 = await makeRecord({ titulo: 'Otra' })
  await prisma.emailDelivery.create({ data: { recordId: r2.id, mode: 'live', status: 'sending', lockKey: `novedad:${r2.id}`, channel: 'web', trigger: 'manual', triggeredByEmail: 'x@alegra.com' } })
  assert.equal((await send(r2.id)).error?.code, 'IN_PROGRESS')
})

test('plantilla con error: se informa como TEMPLATE y no se envía ni se bloquea', async () => {
  const r = await makeRecord()
  await prisma.emailTemplate.create({ data: { key: 'novedad', subject: 'x', html: '{{#if titulo}}sin cerrar', version: 2 } })
  const res = await send(r.id)
  assert.equal(res.error?.code, 'TEMPLATE')
  assert.equal(await prisma.emailDelivery.count(), 0)
})

test('la plantilla editada se usa en el envío', async () => {
  const u = await makeUser('admin@alegra.com', 'ADMIN')
  await saveTemplate({ id: u.id, email: u.email, name: null }, { subject: 'NUEVO: {{titulo}}', html: '<p>Hola {{titulo}}</p>' })
  const r = await makeRecord()
  await send(r.id)
  const mail = await getMessage((await listMessages())[0].ID)
  assert.equal(mail.Subject, 'NUEVO: Facturación masiva')
  assert.match(mail.HTML, /<p>Hola Facturación masiva<\/p>/)
})

test('el HTML de los datos no se cuela en el correo enviado', async () => {
  const r = await makeRecord({ titulo: '<script>alert(1)</script>', breveDescripcion: '<img src=x onerror=alert(1)>' })
  await send(r.id)
  const html = (await getMessage((await listMessages())[0].ID)).HTML
  assert.ok(!html.includes('<script>alert'))
  assert.ok(!html.includes('<img src=x onerror'))
})

test('secretos: ni los resultados ni lo guardado incluyen la contraseña SMTP', async () => {
  process.env.SMTP_PASS = 'clave-super-secreta-123'
  setTransportFactory(() => ({
    sendMail: async () => { throw Object.assign(new Error('login failed clave-super-secreta-123'), { code: 'EAUTH', responseCode: 535, response: '535 clave-super-secreta-123 rechazada' }) },
    verify: async () => true,
  }))
  const r = await makeRecord()
  const res = await send(r.id)
  const dump = JSON.stringify([res, await prisma.emailDelivery.findMany(), await prisma.auditLog.findMany()])
  assert.ok(!dump.includes('clave-super-secreta-123'))
})
