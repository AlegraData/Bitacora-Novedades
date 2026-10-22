import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handleCreateRecord, handleUpdateRecord, handleNotifyPmkt } from '@/lib/mcp/tools'
import type { Caller } from '@/lib/mcp/auth'
import { sendFromButton } from '@/lib/email/button'
import { toClientResult, describeError } from '@/lib/email/public'
import { sendNovedad } from '@/lib/email/service'
import { createApiKey } from '@/lib/api/keys'
import { keyLimiter, failedAuthLimiter } from '@/lib/api/rate-limit'
import { POST as notifyRoute } from '@/app/api/v1/records/[id]/notify-pmkt/route'
import { resetDb, makeUser, ensureFields } from './helpers'
import { clearMailbox, listMessages } from './mailpit'
import { admin, viewer, makeRecord, setMode, startServer, makeWebhookButton, FULL } from './email-helpers'

let ana: Caller
let adm: Caller

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  await prisma.field.deleteMany({ where: { type: 'button' } })
  await clearMailbox()
  keyLimiter.reset()
  failedAuthLimiter.reset()
  const a = await makeUser('ana@alegra.com', 'VIEWER')
  const b = await makeUser('admin@alegra.com', 'ADMIN')
  ana = { id: a.id, email: a.email, name: a.name, role: 'VIEWER' }
  adm = { id: b.id, email: b.email, name: b.name, role: 'ADMIN' }
  await setMode('live')
})
afterEach(() => { delete process.env.PMKT_CHAT_WEBHOOK_URL })

const complete = { ...FULL, elaborado: 'ana@alegra.com' } as Record<string, unknown>

test('MCP create_record: con datos completos envía y devuelve el resultado en "email"', async () => {
  const res = (await handleCreateRecord(complete, ana)) as { id: string; email: { status: string; mode: string; recipients: string[] } }
  assert.equal(res.email.status, 'sent')
  assert.equal(res.email.mode, 'live')
  assert.equal((await listMessages()).length, 1)
  assert.equal((await prisma.emailDelivery.findFirstOrThrow({ where: { recordId: res.id } })).channel, 'mcp')
})

test('MCP create_record: con datos incompletos NO envía y explica qué falta (sin ser un error)', async () => {
  const res = (await handleCreateRecord({ tipo: 'Novedad', titulo: 'T', fechaLanzamiento: '2026-11-01', elaborado: 'ana@alegra.com' }, ana)) as {
    email: { ok: boolean; status: string; skippedReason: string; missingFields: string[] }
  }
  assert.equal(res.email.ok, true)
  assert.equal(res.email.status, 'skipped')
  assert.equal(res.email.skippedReason, 'campos_incompletos')
  assert.ok(res.email.missingFields.includes('Breve descripción'))
  assert.equal((await listMessages()).length, 0)
})

test('MCP update_record: completar lo que faltaba dispara el envío y lo informa; un segundo guardado no reenvía', async () => {
  const created = (await handleCreateRecord({ ...complete, breveDescripcion: undefined }, ana)) as { id: string; email: { status: string } }
  assert.equal(created.email.status, 'skipped')
  const upd = (await handleUpdateRecord({ id: created.id, breveDescripcion: 'Ya completo' }, ana)) as { email: { status: string } }
  assert.equal(upd.email.status, 'sent')
  const upd2 = (await handleUpdateRecord({ id: created.id, titulo: 'Título corregido' }, ana)) as { email: { status: string; skippedReason: string } }
  assert.equal(upd2.email.skippedReason, 'ya_enviado')
  assert.equal((await listMessages()).length, 1)
})

test('MCP create_record: un fallo del correo no hace fallar la creación y se explica en "email.error"', async () => {
  await prisma.emailSettings.update({ where: { id: 'singleton' }, data: { mode: 'webhook' } }) // sin botón configurado
  const res = (await handleCreateRecord(complete, ana)) as { id: string; email: { ok: boolean; error: { code: string; message: string } } }
  assert.ok(res.id)
  assert.equal(await prisma.record.count(), 1)
  assert.equal(res.email.ok, false)
  assert.equal(res.email.error.code, 'MODE_CONFIG')
})

test('MCP notify_pmkt: sin confirm es un simulacro con el texto del correo; con confirm envía; luego avisa duplicado', async () => {
  const r = await makeRecord()
  const preview = (await handleNotifyPmkt({ recordId: r.id }, ana)) as Record<string, unknown>
  assert.equal(preview.preview, true)
  assert.equal(preview.status, 'simulated')
  assert.equal(preview.subject, 'Novedad | Alegra POS - Facturación masiva')
  assert.match(String(preview.text), /Ahora puedes facturar en lote/)
  assert.equal(preview.html, undefined, 'el HTML completo no se devuelve al agente')
  assert.equal((await listMessages()).length, 0)

  const sent = (await handleNotifyPmkt({ recordId: r.id, confirm: true }, ana)) as { status: string }
  assert.equal(sent.status, 'sent')
  const dup = (await handleNotifyPmkt({ recordId: r.id, confirm: true }, ana)) as { ok: boolean; error: { code: string; previous: { by: string } } }
  assert.equal(dup.ok, false)
  assert.equal(dup.error.code, 'DUPLICATE')
  assert.equal(dup.error.previous.by, 'ana@alegra.com')
  assert.equal((await listMessages()).length, 1)
})

test('MCP notify_pmkt: resend solo para ADMIN y con motivo', async () => {
  const r = await makeRecord()
  await handleNotifyPmkt({ recordId: r.id, confirm: true }, ana)
  const denied = (await handleNotifyPmkt({ recordId: r.id, confirm: true, resend: true, reason: 'x' }, ana)) as { error: { code: string } }
  assert.equal(denied.error.code, 'FORBIDDEN')
  const noReason = (await handleNotifyPmkt({ recordId: r.id, confirm: true, resend: true }, adm)) as { error: { code: string } }
  assert.equal(noReason.error.code, 'VALIDATION')
  const ok = (await handleNotifyPmkt({ recordId: r.id, confirm: true, resend: true, reason: 'Corrección' }, adm)) as { status: string }
  assert.equal(ok.status, 'sent')
  assert.equal((await listMessages()).length, 2)
})

test('el detalle técnico del SMTP solo lo ve un ADMIN (en MCP, pantalla y API)', async () => {
  delete process.env.SMTP_HOST
  const r = await makeRecord()
  const forUser = (await handleNotifyPmkt({ recordId: r.id, confirm: true }, ana)) as { error: { code: string; detail?: string } }
  assert.equal(forUser.error.code, 'SMTP_NOT_CONFIGURED')
  assert.equal(forUser.error.detail, undefined)
  const forAdmin = (await handleNotifyPmkt({ recordId: r.id, confirm: true }, adm)) as { error: { detail?: string } }
  assert.match(forAdmin.error.detail ?? '', /SMTP_HOST/)
  process.env.SMTP_HOST = 'localhost'

  const raw = await sendNovedad({ recordId: r.id, actor: viewer, channel: 'web', trigger: 'manual', simulate: true })
  assert.equal(toClientResult(raw, 'VIEWER').html, undefined)
  assert.ok(toClientResult(raw, 'VIEWER', { html: true }).html)
})

test('describeError junta motivo, faltantes, rechazados y quién lo envió antes', () => {
  const t = describeError({ code: 'VALIDATION', message: 'Faltan datos.', missingFields: ['A', 'B'], invalidRecipients: ['x'], rejectedRecipients: ['y@alegra.com'], previous: { deliveryId: '1', sentAt: '2026-10-20T10:00:00Z', by: 'ana@alegra.com' }, detail: '550 no' })
  for (const frag of ['Faltan datos.', 'Falta: A, B', 'inválidas: x', 'y@alegra.com', 'ana@alegra.com', 'Detalle: 550 no']) assert.ok(t.includes(frag), frag)
})

test('botón: en vivo marca el campo del botón y el log; el modo test y los fallos no lo marcan', async () => {
  const log = await prisma.field.create({ data: { name: 'Log', type: 'textarea', order: 500 } })
  const hook = await startServer()
  const btn = await prisma.field.create({ data: { name: 'Enviar email', type: 'button', order: 999, config: { action: 'webhook', webhookUrl: hook.url, logFieldId: log.id } } })
  try {
    const r = await makeRecord()
    const bad = await sendFromButton(viewer, 'no-existe', btn.id)
    assert.equal(bad.error?.code, 'NOT_FOUND')
    assert.equal((await sendFromButton(viewer, r.id, 'campo-que-no-existe')).error?.code, 'NOT_FOUND')

    await setMode('test', { testRecipients: ['yo@alegra.com'] })
    assert.equal((await sendFromButton(viewer, r.id, btn.id)).status, 'sent')
    const afterTest = (await prisma.record.findUniqueOrThrow({ where: { id: r.id } })).data as Record<string, unknown>
    assert.equal(afterTest[btn.id], undefined, 'una prueba no marca la novedad como comunicada')

    await setMode('live')
    const res = await sendFromButton(viewer, r.id, btn.id)
    assert.equal(res.status, 'sent')
    const after = (await prisma.record.findUniqueOrThrow({ where: { id: r.id } })).data as Record<string, unknown>
    assert.ok(after[btn.id], 'fecha en el campo del botón')
    assert.match(String(after[log.id]), /ejecutado por viewer@alegra\.com/)
    // y el resto del registro quedó intacto
    assert.equal(Object.keys(after).length, Object.keys(afterTest).length + 2)
  } finally {
    await hook.close()
    await prisma.field.deleteMany({ where: { id: { in: [log.id, btn.id] } } })
  }
})

test('botón: modo webhook legado sigue funcionando igual que antes (POST con los campos por nombre)', async () => {
  const hook = await startServer()
  const btn = await makeWebhookButton(hook.url)
  try {
    await setMode('webhook')
    const r = await makeRecord()
    const res = await sendFromButton(admin, r.id, btn.id)
    assert.equal(res.status, 'sent')
    assert.equal(res.mode, 'webhook')
    assert.equal(JSON.parse(hook.requests[0].body).data['Breve descripción'], 'Ahora puedes facturar en lote.')
  } finally {
    await hook.close()
    await prisma.field.deleteMany({ where: { id: btn.id } })
  }
})

test('API notify-pmkt: el estado HTTP sale del código del error (409 duplicado, 422 datos, 503 sin SMTP, 403 reenvío)', async () => {
  const key = (await createApiKey({ email: ana.email, role: 'VIEWER' }, { name: 'n', scopes: ['pmkt:notify'] })).token
  const call = (id: string, body: unknown) =>
    notifyRoute(new NextRequest(`http://localhost/api/v1/records/${id}/notify-pmkt`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id }) })

  const r = await makeRecord()
  const sim = await call(r.id, {})
  assert.equal(sim.status, 200)
  assert.equal((await sim.json()).status, 'simulated')

  const ok = await call(r.id, { confirm: true })
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).status, 'sent')

  const dup = await call(r.id, { confirm: true })
  assert.equal(dup.status, 409)
  assert.equal((await dup.json()).error.code, 'DUPLICATE')

  const forbidden = await call(r.id, { confirm: true, resend: true, reason: 'x' })
  assert.equal(forbidden.status, 403)

  const incomplete = await makeRecord({ responsables: [] })
  const miss = await call(incomplete.id, { confirm: true })
  assert.equal(miss.status, 422)
  assert.deepEqual((await miss.json()).error.missingFields, ['Responsables'])

  delete process.env.SMTP_HOST
  const noSmtp = await call((await makeRecord({ titulo: 'Otra' })).id, { confirm: true })
  assert.equal(noSmtp.status, 503)
  const body = await noSmtp.json()
  assert.equal(body.error.code, 'SMTP_NOT_CONFIGURED')
  assert.equal(body.error.detail, undefined, 'un usuario normal no ve el detalle técnico')
  process.env.SMTP_HOST = 'localhost'
})
