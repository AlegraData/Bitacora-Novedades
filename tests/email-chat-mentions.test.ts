import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { prisma } from '@/lib/prisma'
import { buildChatMessage, mentionText } from '@/lib/email/chat'
import { resolveChatUsers, itHubConfigured } from '@/lib/email/it-hub'
import { ensureChatIds } from '@/lib/email/chat-ids'
import { sendNovedad } from '@/lib/email/service'
import { getSettings } from '@/lib/email/settings'
import { resolveIdsForAdmin, sendChatTest, testLimiter } from '@/lib/email/admin-tools'
import { DEFAULT_NOTIFY_RECIPIENTS } from '@/lib/email/recipients'
import { Prisma } from '@/generated/prisma'
import { resetDb, makeUser, ensureFields } from './helpers'
import { clearMailbox } from './mailpit'
import { viewer, makeRecord, setMode, startServer, makeWebhookButton, type TestServer } from './email-helpers'

const IDS: Record<string, { id: string; fullName: string }> = {
  'cristian.albornoz@alegra.com': { id: '105277208503173878668', fullName: 'Cristian Albornoz Arias' },
  'cristian.bautista@alegra.com': { id: '102164574918902596487', fullName: 'Cristian Bautista' },
  'valentina.garcia@alegra.com': { id: '109075695141408003332', fullName: 'Valentina García' },
}

interface ItHub { url: string; calls: { email: string; key: string | undefined }[]; mode: { status: number }; close: () => Promise<void> }

/** IT Hub falso: valida la llave como el real y responde con los IDs conocidos. */
async function startItHub(): Promise<ItHub> {
  const calls: ItHub['calls'] = []
  const mode = { status: 200 }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '', 'http://x')
    const key = req.headers['x-api-key'] as string | undefined
    const email = u.searchParams.get('email') ?? ''
    calls.push({ email, key })
    res.setHeader('content-type', 'application/json')
    if (mode.status !== 200) { res.statusCode = mode.status; return void res.end('{"error":"x"}') }
    if (key !== 'clave-de-prueba') { res.statusCode = 401; return void res.end('{"error":"API key inválida o no autorizada"}') }
    const hit = IDS[email]
    if (!hit) { res.statusCode = 404; return void res.end(JSON.stringify({ email, error: 'Resource Not Found: userKey' })) }
    res.end(JSON.stringify({ email, id: hit.id, fullName: hit.fullName }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, mode, close: () => new Promise((r) => server.close(() => r())) }
}

// Las pruebas del mecanismo de menciones usan estos tres como destinatarios (la configuración por defecto de
// producción ahora es el grupo tm-alegra, sin menciones: ver el último bloque de pruebas).
const MENTIONED = [
  { email: 'cristian.albornoz@alegra.com', name: 'Cristian Albornoz Arias' },
  { email: 'cristian.bautista@alegra.com', name: 'Cristian Bautista' },
  { email: 'valentina.garcia@alegra.com', name: 'Valentina García' },
]
const useRecipients = (list: unknown[]) =>
  prisma.emailSettings.update({ where: { id: 'singleton' }, data: { notifyRecipients: list as unknown as Prisma.InputJsonValue } })

const ENV = ['IT_HUB_URL', 'IT_HUB_API_KEY', 'PMKT_CHAT_WEBHOOK_URL', 'PMKT_CHAT_TEST_WEBHOOK_URL'] as const
let saved: Record<string, string | undefined>
let hub: ItHub
const servers: TestServer[] = []
let actor: { id: string; email: string; name: string | null }

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  await prisma.field.deleteMany({ where: { type: 'button' } })
  await clearMailbox()
  testLimiter.reset()
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  hub = await startItHub()
  process.env.IT_HUB_URL = hub.url
  process.env.IT_HUB_API_KEY = 'clave-de-prueba'
  delete process.env.PMKT_CHAT_WEBHOOK_URL
  delete process.env.PMKT_CHAT_TEST_WEBHOOK_URL
  const u = await makeUser('admin@alegra.com', 'ADMIN')
  actor = { id: u.id, email: u.email, name: u.name }
  await setMode('live')
  await useRecipients(MENTIONED)
})
afterEach(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  await hub.close()
  while (servers.length) await servers.pop()!.close()
})

const chat = async () => {
  const s = await startServer()
  servers.push(s)
  return s
}
const bodyOf = (s: TestServer, i = 0) => JSON.parse(s.requests[i].body)

test('menciones: solo IDs numéricos válidos se vuelven <users/ID>; nunca <users/all>; los nombres se limpian', () => {
  assert.equal(mentionText([{ chatUserId: '105277208503173878668', name: 'Ana' }, { chatUserId: '109075695141408003332' }]), '<users/105277208503173878668> <users/109075695141408003332>')
  assert.equal(mentionText([{ name: 'Sin ID' }]), 'Sin ID', 'sin ID se nombra en texto, sin notificar')
  for (const evil of ['all', '<users/all>', 'abc', '12', '1; DROP', '105277208503173878668>x']) {
    const t = mentionText([{ chatUserId: evil, name: 'Pepe' }])
    assert.ok(!t.includes('<users/'), `ID hostil convertido en mención: ${evil}`)
    assert.equal(t, 'Pepe')
  }
  assert.equal(mentionText([{ name: '<b>*Ana*_</b>' }]), 'bAna/b')
  assert.equal(mentionText([]), '')
  assert.equal(mentionText([{}]), '')
})

test('mensaje de Chat: línea de menciones en `text` y la tarjeta igual que antes; sin destinatarios no hay `text`', () => {
  const card = { elaborado: 'ana@alegra.com', titulo: 'Mi novedad', tipo: 'Novedad', url: 'https://bitacora.test/app?record=r1' }
  const m = buildChatMessage(card, [{ name: 'Cristian', chatUserId: '105277208503173878668' }, { name: 'Valentina', chatUserId: '109075695141408003332' }])
  assert.match(m.text!, /<users\/105277208503173878668> <users\/109075695141408003332>/)
  assert.equal(m.cardsV2[0].card.header.title, 'Novedades de Product 📝')
  assert.match((m.cardsV2[0].card.sections[0].widgets[0] as { textParagraph: { text: string } }).textParagraph.text, /Mi novedad/)
  assert.equal(buildChatMessage(card, []).text, undefined)
  assert.equal(buildChatMessage(card).cardsV2.length, 1)
  assert.ok(!JSON.stringify(buildChatMessage({ ...card, titulo: '<b>x</b>' }, [])).includes('<b>x</b>'), 'el título se escapa')
})

test('IT Hub: resuelve IDs con la llave en el header; 404 y llave inválida dan mensajes claros sin filtrar la llave', async () => {
  assert.equal(itHubConfigured(), true)
  const r = await resolveChatUsers(['Cristian.Albornoz@alegra.com', 'valentina.garcia@alegra.com', 'no.existe@alegra.com'])
  assert.deepEqual(r.map((x) => [x.email, x.id, x.fullName]), [
    ['cristian.albornoz@alegra.com', '105277208503173878668', 'Cristian Albornoz Arias'],
    ['valentina.garcia@alegra.com', '109075695141408003332', 'Valentina García'],
    ['no.existe@alegra.com', undefined, undefined],
  ])
  assert.match(r[2].error!, /No existe en el directorio/)
  assert.ok(hub.calls.every((c) => c.key === 'clave-de-prueba'))

  process.env.IT_HUB_API_KEY = 'otra-clave'
  const bad = await resolveChatUsers(['cristian.albornoz@alegra.com'])
  assert.match(bad[0].error!, /rechazó la llave/)
  assert.ok(!JSON.stringify(bad).includes('otra-clave'), 'la llave nunca aparece en los resultados')
})

test('IT Hub: sin configurar, con URL insegura o caído → error por correo, nunca excepción', async () => {
  delete process.env.IT_HUB_API_KEY
  assert.equal(itHubConfigured(), false)
  assert.match((await resolveChatUsers(['a@alegra.com']))[0].error!, /no está configurado/)

  process.env.IT_HUB_API_KEY = 'clave-de-prueba'
  process.env.IT_HUB_URL = 'http://evil.example.com'
  assert.equal(itHubConfigured(), false, 'solo https (o localhost en tests)')

  process.env.IT_HUB_URL = hub.url
  hub.mode.status = 503
  assert.match((await resolveChatUsers(['cristian.albornoz@alegra.com']))[0].error!, /503/)
  await hub.close()
  assert.match((await resolveChatUsers(['cristian.albornoz@alegra.com']))[0].error!, /No se pudo conectar/)
  hub = await startItHub() // para el afterEach
})

test('IT Hub: respuestas con IDs inválidos se rechazan (no llegan a una mención)', async () => {
  const srv = http.createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: '<users/all>', fullName: 'x' })) })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  process.env.IT_HUB_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
  const r = await resolveChatUsers(['a@alegra.com'])
  assert.equal(r[0].id, undefined)
  assert.match(r[0].error!, /ID válido/)
  await new Promise<void>((res) => srv.close(() => res()))
})

test('correo en vivo: la tarjeta de Chat menciona a los tres, y los IDs se resuelven una vez y se guardan', async () => {
  const c = await chat()
  process.env.PMKT_CHAT_WEBHOOK_URL = c.url
  const r1 = await makeRecord()
  assert.equal((await sendNovedad({ recordId: r1.id, actor: viewer, channel: 'web', trigger: 'manual' })).chat, 'sent')

  const msg = bodyOf(c)
  for (const { id } of Object.values(IDS)) assert.ok(msg.text.includes(`<users/${id}>`), `falta la mención de ${id}`)
  assert.match(msg.cardsV2[0].card.sections[0].widgets[0].textParagraph.text, /Facturación masiva/)
  assert.equal(hub.calls.length, 3)

  const s = await getSettings()
  assert.deepEqual(s.recipients.map((x) => x.chatUserId), Object.values(IDS).map((x) => x.id))
  assert.equal(s.recipientsCustomized, true, 'los IDs resueltos quedan guardados')

  // segundo envío: ya no se consulta el IT Hub
  const r2 = await makeRecord({ titulo: 'Otra' })
  await sendNovedad({ recordId: r2.id, actor: viewer, channel: 'web', trigger: 'manual' })
  assert.equal(hub.calls.length, 3)
  assert.ok(bodyOf(c, 1).text.includes('<users/105277208503173878668>'))
})

test('si el IT Hub falla, el correo y la tarjeta salen igual: las personas aparecen por nombre, sin notificar', async () => {
  const c = await chat()
  process.env.PMKT_CHAT_WEBHOOK_URL = c.url
  hub.mode.status = 500
  const r = await makeRecord()
  const res = await sendNovedad({ recordId: r.id, actor: viewer, channel: 'web', trigger: 'manual' })
  assert.equal(res.status, 'sent')
  assert.equal(res.chat, 'sent')
  const msg = bodyOf(c)
  assert.ok(!msg.text.includes('<users/'))
  assert.ok(msg.text.includes('Cristian Albornoz Arias') && msg.text.includes('Valentina García'))
  assert.ok((await getSettings()).recipients.every((x) => !x.chatUserId), 'no se guardó ningún ID')
})

test('un ID ya guardado a mano se respeta y solo se consulta lo que falta', async () => {
  const resolved = await ensureChatIds([
    { email: 'cristian.albornoz@alegra.com', chatUserId: '999999999999999999999' },
    { email: 'valentina.garcia@alegra.com' },
  ])
  assert.equal(resolved.recipients[0].chatUserId, '999999999999999999999')
  assert.equal(resolved.recipients[1].chatUserId, IDS['valentina.garcia@alegra.com'].id)
  assert.deepEqual(hub.calls.map((x) => x.email), ['valentina.garcia@alegra.com'])
})

test('en modo Apps Script (webhook) la app NO publica en Chat (lo sigue haciendo el script)', async () => {
  const c = await chat()
  process.env.PMKT_CHAT_WEBHOOK_URL = c.url
  const script = await startServer()
  servers.push(script)
  await makeWebhookButton(script.url)
  await setMode('webhook')
  await sendNovedad({ recordId: (await makeRecord()).id, actor: viewer, channel: 'web', trigger: 'manual' })
  assert.equal(c.requests.length, 0)
  assert.equal(hub.calls.length, 0)
})

test('resolver IDs desde el admin: solo correos válidos y distintos, sin guardar nada', async () => {
  const r = await resolveIdsForAdmin(['cristian.albornoz@alegra.com', 'CRISTIAN.ALBORNOZ@alegra.com', 'mal-escrito', 'a@alegra.com Bcc: x@y.com'])
  assert.deepEqual(r.map((x) => x.email), ['cristian.albornoz@alegra.com'])
  assert.ok((await getSettings()).recipients.every((x) => !x.chatUserId), 'no se guardó nada')
  assert.deepEqual(await resolveIdsForAdmin('no es una lista'), [])
})

test('mensaje de prueba de Chat: va al espacio de pruebas si existe; si no, al canal real; menciona a los tres y se audita', async () => {
  const real = await chat()
  const test = await chat()
  process.env.PMKT_CHAT_WEBHOOK_URL = real.url

  const toReal = await sendChatTest(actor)
  assert.deepEqual([toReal.ok, toReal.target], [true, 'produccion'])
  assert.equal(real.requests.length, 1)
  const text = bodyOf(real).text
  assert.ok(text.includes('[PRUEBA]'))
  for (const { id } of Object.values(IDS)) assert.ok(text.includes(`<users/${id}>`))
  assert.deepEqual(toReal.mentioned.sort(), ['Cristian Albornoz Arias', 'Cristian Bautista', 'Valentina García'])

  process.env.PMKT_CHAT_TEST_WEBHOOK_URL = test.url
  const toTest = await sendChatTest(actor)
  assert.equal(toTest.target, 'prueba')
  assert.equal(test.requests.length, 1)
  assert.equal(real.requests.length, 1, 'con espacio de pruebas no se toca el canal real')

  const audit = await prisma.auditLog.findMany({ where: { action: 'EMAIL_CHAT_TEST' } })
  assert.equal(audit.length, 2)
  assert.ok(!JSON.stringify([toReal, toTest, audit]).includes(real.url), 'la URL del webhook nunca sale en resultados ni auditoría')
})

test('mensaje de prueba de Chat: sin webhook, con webhook caído y límite por hora', async () => {
  const none = await sendChatTest(actor)
  assert.deepEqual([none.ok, none.target], [false, 'ninguno'])
  assert.match(none.error!, /No hay webhook/)

  const c = await chat()
  c.respond.status = 500
  process.env.PMKT_CHAT_WEBHOOK_URL = c.url
  const failed = await sendChatTest(actor)
  assert.equal(failed.ok, false)
  assert.match(failed.error!, /500/)

  testLimiter.reset()
  c.respond.status = 200
  for (let i = 0; i < 10; i++) assert.equal((await sendChatTest(actor)).ok, true)
  assert.match((await sendChatTest(actor)).error!, /Máximo 10 mensajes/)
})

test('los tres de TMDIAPD-56 siguen coincidiendo con los IDs conocidos del directorio (para cuando se vuelvan a usar)', () => {
  assert.deepEqual(MENTIONED.map((r) => r.email), Object.keys(IDS))
})

test('configuración por defecto (grupo tm-alegra, sin menciones): el correo va al grupo, la tarjeta no menciona a nadie y no se consulta el IT Hub', async () => {
  await prisma.emailSettings.update({ where: { id: 'singleton' }, data: { notifyRecipients: Prisma.DbNull } })
  const c = await chat()
  process.env.PMKT_CHAT_WEBHOOK_URL = c.url
  const res = await sendNovedad({ recordId: (await makeRecord()).id, actor: viewer, channel: 'web', trigger: 'manual' })
  assert.equal(res.status, 'sent')
  assert.deepEqual(res.recipients, ['tm-alegra@alegra.com'])
  assert.equal(res.chat, 'sent')

  const msg = bodyOf(c)
  assert.equal(msg.text, undefined, 'sin línea de menciones')
  assert.ok(!JSON.stringify(msg).includes('<users/'))
  assert.match(msg.cardsV2[0].card.sections[0].widgets[0].textParagraph.text, /Facturación masiva/, 'la tarjeta sale igual')
  assert.equal(hub.calls.length, 0, 'no se busca el ID de un grupo')
  assert.deepEqual(DEFAULT_NOTIFY_RECIPIENTS.map((r) => r.mention), [false])
})

test('«Mencionar en Chat» apagado: ni se busca su ID ni se nombra; los demás sí se mencionan', async () => {
  await useRecipients([{ email: 'tm-alegra@alegra.com', mention: false }, MENTIONED[0]])
  const c = await chat()
  process.env.PMKT_CHAT_WEBHOOK_URL = c.url
  const res = await sendNovedad({ recordId: (await makeRecord()).id, actor: viewer, channel: 'web', trigger: 'manual' })
  assert.deepEqual(res.recipients, ['tm-alegra@alegra.com', 'cristian.albornoz@alegra.com'], 'ambos reciben el correo')
  const msg = bodyOf(c)
  assert.ok(msg.text.endsWith('<users/105277208503173878668>'), 'solo se menciona al marcado')
  assert.equal(msg.text.match(/<users\//g).length, 1)
  assert.ok(!/tm-alegra|TM Alegra/.test(msg.text), 'el grupo no se nombra')
  assert.deepEqual(hub.calls.map((x) => x.email), ['cristian.albornoz@alegra.com'])

  const test = await sendChatTest(actor)
  assert.deepEqual(test.mentioned, ['Cristian Albornoz Arias'])
})
