/**
 * Smoke e2e del envío de correos por HTTP real (API REST y MCP) contra `next start`, con la base de
 * pruebas y Mailpit como SMTP de captura. Requiere el servidor corriendo con estas variables:
 *
 *   SMTP_HOST=localhost SMTP_PORT=1025 SMTP_USER=data.news@alegra.com SMTP_SECURE=false \
 *   APP_PUBLIC_URL=https://bitacora.test DATABASE_URL=<local> npx next start -p 3999
 *   E2E_BASE_URL=http://localhost:3999 npm run test:e2e:email
 */
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { createApiKey } from '@/lib/api/keys'
import { resetDb, makeUser, ensureFields } from '../helpers'
import { clearMailbox, getMessage, listMessages } from '../mailpit'
import { makeRecord, setMode } from '../email-helpers'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3999'
let failures = 0

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`  ✔ ${name}`)
  } catch (e) {
    failures++
    console.log(`  ✖ ${name}\n    ${(e as Error).message.split('\n')[0]}`)
  }
}

const api = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
  })

async function mcp(token: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  const body = await res.json()
  return JSON.parse(body.result.content[0].text) as Record<string, unknown> & { error?: { code: string; detail?: string } }
}

const complete = {
  tipo: 'Novedad', titulo: 'Facturación masiva', breveDescripcion: 'Ahora puedes facturar en lote.', fechaLanzamiento: '2026-11-01',
  fechaProduccion: '2026-11-05', responsables: ['ana@alegra.com'], correosAComunicar: ['dest1@alegra.com', 'dest2@alegra.com'],
  elaborado: 'viewer@alegra.com', producto: ['Alegra POS'], traeVideo: 'No',
}

async function main() {
  await resetDb()
  await ensureFields()
  await prisma.field.deleteMany({ where: { type: 'button' } })
  await clearMailbox()
  await makeUser('admin@alegra.com', 'ADMIN')
  await makeUser('viewer@alegra.com', 'VIEWER')
  await setMode('live')

  const viewerKey = (await createApiKey({ email: 'viewer@alegra.com', role: 'VIEWER' }, { name: 'v', scopes: ['records:read', 'records:write', 'pmkt:notify'] })).token
  const adminKey = (await createApiKey({ email: 'admin@alegra.com', role: 'ADMIN' }, { name: 'a', scopes: ['records:read', 'records:write', 'pmkt:notify', 'audit:read'] })).token
  const viewerOauth = 'e2e-mcp-viewer-token'
  const adminOauth = 'e2e-mcp-admin-token'
  for (const [tok, email] of [[viewerOauth, 'viewer@alegra.com'], [adminOauth, 'admin@alegra.com']] as const) {
    await prisma.oAuthSession.create({
      data: { accessToken: tok, refreshToken: tok + '-r', userEmail: email, clientId: 'e2e', expiresAt: new Date(Date.now() + 3_600_000), refreshExpiresAt: new Date(Date.now() + 86_400_000) },
    })
  }

  console.log(`E2E de correos contra ${BASE}`)
  let recordId = ''

  await check('POST /records completo → 201 y el correo se envía solo (email.status = sent)', async () => {
    const r = await api('/records', viewerKey, { method: 'POST', body: JSON.stringify(complete) })
    assert.equal(r.status, 201)
    const body = await r.json()
    recordId = body.id
    assert.equal(body.email.status, 'sent')
    assert.equal(body.email.mode, 'live')
  })

  await check('el correo llegó por SMTP con asunto, destinatarios, link y HTML escapado', async () => {
    const msgs = await listMessages()
    assert.equal(msgs.length, 1)
    const mail = await getMessage(msgs[0].ID)
    assert.equal(mail.Subject, 'Novedad | Alegra POS - Facturación masiva')
    assert.deepEqual(mail.To.map((t) => t.Address).sort(), ['cristian.albornoz@alegra.com', 'cristian.bautista@alegra.com', 'valentina.garcia@alegra.com'])
    assert.ok(!JSON.stringify(mail.To).includes('dest1@alegra.com'), 'solo los destinatarios de la notificación, no los del registro')
    assert.equal(mail.From.Name, 'Alegra Product News')
    assert.ok(mail.Text.includes(`https://bitacora.test/app?record=${recordId}`))
    assert.match(mail.HTML, /Ahora puedes facturar en lote/)
  })

  await check('GET /records/{id}/email-deliveries muestra el envío (quién, canal, resultado)', async () => {
    const body = await (await api(`/records/${recordId}/email-deliveries`, viewerKey)).json()
    assert.equal(body.total, 1)
    assert.deepEqual([body.deliveries[0].status, body.deliveries[0].channel, body.deliveries[0].triggeredByEmail], ['sent', 'api', 'viewer@alegra.com'])
    assert.equal(body.deliveries[0].html, undefined)
  })

  await check('reenviar: 409 DUPLICATE con quién lo envió; no sale otro correo', async () => {
    const r = await api(`/records/${recordId}/notify-pmkt`, viewerKey, { method: 'POST', body: JSON.stringify({ confirm: true }) })
    assert.equal(r.status, 409)
    const body = await r.json()
    assert.equal(body.error.code, 'DUPLICATE')
    assert.equal(body.error.previous.by, 'viewer@alegra.com')
    assert.equal((await listMessages()).length, 1)
  })

  await check('un usuario normal no puede forzar el reenvío (403); un ADMIN sí, con motivo', async () => {
    const denied = await api(`/records/${recordId}/notify-pmkt`, viewerKey, { method: 'POST', body: JSON.stringify({ confirm: true, resend: true, reason: 'x' }) })
    assert.equal(denied.status, 403)
    const noReason = await api(`/records/${recordId}/notify-pmkt`, adminKey, { method: 'POST', body: JSON.stringify({ confirm: true, resend: true }) })
    assert.equal(noReason.status, 422)
    const ok = await api(`/records/${recordId}/notify-pmkt`, adminKey, { method: 'POST', body: JSON.stringify({ confirm: true, resend: true, reason: 'Corrección' }) })
    assert.equal(ok.status, 200)
    assert.equal((await listMessages()).length, 2)
  })

  await check('simulacro por API: 200 sin enviar; novedad incompleta → 422 con los campos que faltan', async () => {
    const before = (await listMessages()).length
    const sim = await api(`/records/${recordId}/notify-pmkt`, viewerKey, { method: 'POST', body: '{}' })
    assert.equal((await sim.json()).status, 'simulated')
    const inc = await api('/records', viewerKey, { method: 'POST', body: JSON.stringify({ ...complete, titulo: 'Incompleta', responsables: undefined }) })
    const incBody = await inc.json()
    assert.equal(incBody.email.status, 'skipped')
    assert.deepEqual(incBody.email.missingFields, ['Responsables'])
    const manual = await api(`/records/${incBody.id}/notify-pmkt`, viewerKey, { method: 'POST', body: JSON.stringify({ confirm: true }) })
    assert.equal(manual.status, 422)
    assert.deepEqual((await manual.json()).error.missingFields, ['Responsables'])
    assert.equal((await listMessages()).length, before)
  })

  await check('MCP: notify_pmkt envía, list_email_deliveries lo muestra y el detalle técnico solo lo ve un ADMIN', async () => {
    const r = await makeRecord({ titulo: 'Por MCP', elaborado: ['viewer@alegra.com'] })
    const before = (await listMessages()).length
    const sent = await mcp(viewerOauth, 'notify_pmkt', { recordId: r.id, confirm: true })
    assert.equal(sent.status, 'sent')
    assert.equal((await listMessages()).length, before + 1)
    const dup = await mcp(viewerOauth, 'notify_pmkt', { recordId: r.id, confirm: true })
    assert.equal(dup.error?.code, 'DUPLICATE')
    const list = (await mcp(adminOauth, 'list_email_deliveries', { recordId: r.id })) as { total: number; deliveries: { channel: string }[] }
    assert.equal(list.total, 1)
    assert.equal(list.deliveries[0].channel, 'mcp')
  })

  await check('sin SMTP configurado el error es claro y sin detalle técnico para un usuario normal', async () => {
    await prisma.emailSettings.update({ where: { id: 'singleton' }, data: { mode: 'webhook' } }) // modo legado sin botón → MODE_CONFIG
    const r = await makeRecord({ titulo: 'Sin config', elaborado: ['viewer@alegra.com'] })
    const res = await api(`/records/${r.id}/notify-pmkt`, viewerKey, { method: 'POST', body: JSON.stringify({ confirm: true }) })
    assert.equal(res.status, 503)
    const body = await res.json()
    assert.equal(body.error.code, 'MODE_CONFIG')
    await setMode('live')
  })

  await check('ninguna respuesta filtra secretos (contraseña SMTP, llaves de Chat)', async () => {
    const texts = [
      await (await api(`/records/${recordId}/email-deliveries`, adminKey)).text(),
      await (await api('/email-deliveries', adminKey)).text(),
    ]
    for (const t of texts) assert.ok(!/SMTP_PASS|key=|token=|clave/i.test(t))
  })

  console.log(failures === 0 ? '\nE2E de correos OK' : `\n${failures} fallo(s)`)
  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
