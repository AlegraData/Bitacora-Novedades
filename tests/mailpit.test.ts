import { test } from 'node:test'
import assert from 'node:assert/strict'
import nodemailer from 'nodemailer'
import { clearMailbox, getMessage, listMessages, mailpitUp } from './mailpit'

test('el SMTP de captura (Mailpit) está arriba y los tests no usan un SMTP real', async () => {
  assert.equal(process.env.SMTP_HOST, 'localhost')
  assert.ok(await mailpitUp(), 'Mailpit no responde: corre "npm run test:db:up"')
})

test('un correo enviado por SMTP se puede leer por la API de captura', async () => {
  await clearMailbox()
  const t = nodemailer.createTransport({ host: 'localhost', port: 1025, secure: false })
  await t.sendMail({ from: '"Prueba" <a@alegra.com>', to: 'b@alegra.com', subject: 'hola', html: '<b>x</b>' })
  const [m] = await listMessages()
  assert.equal(m.Subject, 'hola')
  assert.match((await getMessage(m.ID)).HTML, /<b>x<\/b>/)
})
