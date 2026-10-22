import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  sendMail, verifySmtp, parseRecipients, mapSmtpError, getSmtpConfig, smtpStatus, setTransportFactory, MAX_RECIPIENTS,
} from '@/lib/email/transport'
import { EmailSendError } from '@/lib/email/errors'
import { clearMailbox, getHeaders, getMessage, listMessages } from './mailpit'

const ENV = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE'] as const
let saved: Record<string, string | undefined>

beforeEach(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  setTransportFactory(null)
  await clearMailbox()
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  setTransportFactory(null)
})

const mail = { to: ['uno@alegra.com'], subject: 'Asunto', html: '<p>Hola</p>', text: 'Hola', fromName: 'Alegra Product News' }

test('envío real por SMTP: remitente, nombre visible, destinatarios, asunto, html y texto llegan intactos', async () => {
  const r = await sendMail({ ...mail, to: ['uno@alegra.com', 'dos@alegra.com'], replyTo: 'respuestas@alegra.com' })
  assert.deepEqual(r.accepted.sort(), ['dos@alegra.com', 'uno@alegra.com'])
  const [m] = await listMessages()
  const full = await getMessage(m.ID)
  assert.equal(full.From.Address, 'data.news@alegra.com')
  assert.equal(full.From.Name, 'Alegra Product News')
  assert.deepEqual(full.To.map((t) => t.Address).sort(), ['dos@alegra.com', 'uno@alegra.com'], 'todos en To, como en el Apps Script')
  assert.equal(full.Cc?.length ?? 0, 0)
  assert.equal(full.ReplyTo?.[0].Address, 'respuestas@alegra.com')
  assert.equal(full.Subject, 'Asunto')
  assert.match(full.HTML, /<p>Hola<\/p>/)
  assert.match(full.Text, /Hola/)
})

test('parseRecipients: normaliza, deduplica y separa inválidos', () => {
  const r = parseRecipients(['Ana@Alegra.com', 'ana@alegra.com', 'b@alegra.com, c@alegra.com', 'sin-arroba', 'x@y', '  ', 'a b@c.com'])
  assert.deepEqual(r.valid, ['ana@alegra.com', 'b@alegra.com', 'c@alegra.com'])
  assert.ok(r.invalid.includes('sin-arroba') && r.invalid.includes('x@y'))
  assert.deepEqual(parseRecipients(undefined), { valid: [], invalid: [] })
  assert.deepEqual(parseRecipients([1, null, {}]), { valid: [], invalid: [] })
})

test('inyección de cabeceras: CR/LF en destinatarios, nombre o asunto no crean Bcc/cabeceras nuevas', async () => {
  const bad = parseRecipients(['a@alegra.com\r\nBcc: evil@x.com', 'b@alegra.com>\nBcc: evil@x.com'])
  assert.deepEqual(bad.valid.filter((v) => v.includes('evil')), [])

  await sendMail({ ...mail, subject: 'Hola\r\nBcc: evil@x.com\r\nX-Evil: 1', fromName: 'Evil\r\nBcc: evil@x.com <x@y.com>' })
  const [m] = await listMessages()
  const headers = await getHeaders(m.ID)
  assert.equal(headers['Bcc'], undefined)
  assert.equal(headers['X-Evil'], undefined)
  assert.ok(!/evil@x\.com/.test(JSON.stringify((await getMessage(m.ID)).To)))
})

test('límites de destinatarios: ninguno válido y demasiados → VALIDATION', async () => {
  await assert.rejects(sendMail({ ...mail, to: ['malo', 'x@y'] }), (e) => e instanceof EmailSendError && e.info.code === 'VALIDATION')
  const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `u${i}@alegra.com`)
  await assert.rejects(sendMail({ ...mail, to: many }), (e) => e instanceof EmailSendError && /máximo/.test(e.info.message))
  assert.equal((await listMessages()).length, 0)
})

test('sin configuración SMTP → SMTP_NOT_CONFIGURED con las variables que faltan (sin nunca nombrar secretos)', async () => {
  delete process.env.SMTP_HOST
  assert.equal(getSmtpConfig(), null)
  await assert.rejects(sendMail(mail), (e) => e instanceof EmailSendError && e.info.code === 'SMTP_NOT_CONFIGURED' && /SMTP_HOST/.test(e.info.detail ?? ''))
  assert.equal((await verifySmtp()).ok, false)
})

test('contra un servidor real se exige contraseña; el SMTP local de pruebas no', () => {
  process.env.SMTP_HOST = 'smtp.gmail.com'
  process.env.SMTP_PORT = '587'
  delete process.env.SMTP_PASS
  assert.equal(getSmtpConfig(), null)
  assert.deepEqual(smtpStatus().missing, ['SMTP_PASS'])
  process.env.SMTP_PASS = 'secreto-super-largo'
  const cfg = getSmtpConfig()!
  assert.equal(cfg.secure, false)
  assert.equal(cfg.host, 'smtp.gmail.com')
  const status = smtpStatus()
  assert.equal(status.hasPassword, true)
  assert.ok(!JSON.stringify(status).includes('secreto-super-largo'), 'el estado para el admin nunca incluye la contraseña')
  delete process.env.SMTP_SECURE
  process.env.SMTP_PORT = '465'
  assert.equal(getSmtpConfig()!.secure, true, 'el puerto 465 usa TLS implícito por defecto')
})

test('verifySmtp: ok contra Mailpit; CONNECTION si el puerto no responde', async () => {
  assert.deepEqual(await verifySmtp(), { ok: true })
  process.env.SMTP_PORT = '9'
  const r = await verifySmtp()
  assert.ok(!r.ok && r.error.code === 'CONNECTION')
})

test('clasificación de errores SMTP', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ code: 'EAUTH', responseCode: 535, response: '535-5.7.8 Username and Password not accepted' }, 'SMTP_AUTH'],
    [{ responseCode: 534, response: '534 5.7.9 Application-specific password required' }, 'SMTP_AUTH'],
    [{ responseCode: 550, response: '550 5.4.5 Daily user sending limit exceeded' }, 'RATE_LIMIT'],
    [{ responseCode: 421, response: '421 4.7.0 Try again later' }, 'RATE_LIMIT'],
    [{ responseCode: 550, response: '550 5.1.1 The email account that you tried to reach does not exist', rejected: ['x@alegra.com'] }, 'RECIPIENT_REJECTED'],
    [{ code: 'EENVELOPE', message: 'No recipients defined' }, 'RECIPIENT_REJECTED'],
    [{ code: 'ETIMEDOUT', message: 'Connection timeout' }, 'TIMEOUT'],
    [{ code: 'ECONNRESET' }, 'TIMEOUT'],
    [{ code: 'ECONNECTION', message: 'connect ECONNREFUSED' }, 'CONNECTION'],
    [{ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND smtp.x' }, 'CONNECTION'],
    [{ responseCode: 554, response: '554 5.7.1 Message rejected as spam' }, 'MESSAGE_REJECTED'],
    [{ message: 'algo raro' }, 'UNKNOWN'],
  ]
  for (const [err, code] of cases) assert.equal(mapSmtpError(err).code, code, JSON.stringify(err))
  assert.deepEqual(mapSmtpError({ responseCode: 550, response: '550 5.1.1 no existe', rejected: ['x@alegra.com'] }).rejectedRecipients, ['x@alegra.com'])
  assert.equal(mapSmtpError(null).code, 'UNKNOWN')
})

test('los errores nunca filtran la contraseña ni credenciales en base64', async () => {
  process.env.SMTP_PASS = 'mi-clave-de-aplicacion'
  const b64 = Buffer.from('\u0000data.news@alegra.com\u0000mi-clave-de-aplicacion').toString('base64')
  const e = mapSmtpError({ code: 'EAUTH', responseCode: 535, response: `535 mi-clave-de-aplicacion rechazada AUTH PLAIN ${b64}` })
  assert.ok(!e.detail!.includes('mi-clave-de-aplicacion'))
  assert.ok(!e.detail!.includes(b64))
})

test('un fallo del transporte llega como EmailSendError clasificado y no se pierde nada', async () => {
  setTransportFactory(() => ({
    sendMail: async () => { throw Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535, response: '535 bad credentials' }) },
    verify: async () => true,
  }))
  await assert.rejects(sendMail(mail), (e) => e instanceof EmailSendError && e.info.code === 'SMTP_AUTH' && /535/.test(e.info.detail ?? ''))
})

test('si el servidor no acepta a nadie se reporta como rechazo, no como éxito', async () => {
  setTransportFactory(() => ({
    sendMail: async () => ({ messageId: 'x', accepted: [], rejected: ['uno@alegra.com'], response: '550 no' }),
    verify: async () => true,
  }))
  await assert.rejects(sendMail(mail), (e) => e instanceof EmailSendError && e.info.code === 'RECIPIENT_REJECTED' && e.info.rejectedRecipients?.[0] === 'uno@alegra.com')
})

test('rechazo parcial: se informa quiénes fueron rechazados sin fallar el envío', async () => {
  setTransportFactory(() => ({
    sendMail: async () => ({ messageId: '<m@x>', accepted: ['uno@alegra.com'], rejected: ['dos@alegra.com'], response: '250 ok' }),
    verify: async () => true,
  }))
  const r = await sendMail({ ...mail, to: ['uno@alegra.com', 'dos@alegra.com'] })
  assert.deepEqual(r.rejected, ['dos@alegra.com'])
})

test('la contraseña de aplicación de Google (con espacios, en bloques de 4) se normaliza', () => {
  process.env.SMTP_HOST = 'smtp.gmail.com'
  process.env.SMTP_PASS = 'abcd efgh ijkl mnop'
  assert.equal(getSmtpConfig()!.pass, 'abcdefghijklmnop')
  process.env.SMTP_PASS = '  abcd\tefgh  '
  assert.equal(getSmtpConfig()!.pass, 'abcdefgh')
  process.env.SMTP_PASS = '   '
  assert.equal(getSmtpConfig(), null, 'solo espacios cuenta como no configurada')
})
