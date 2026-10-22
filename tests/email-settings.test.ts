import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { getSettings, updateSettings, MAX_TEST_RECIPIENTS } from '@/lib/email/settings'
import { getActiveTemplate, saveTemplate, restoreDefault, restoreRevision, listRevisions } from '@/lib/email/template-store'
import { DEFAULT_HTML, DEFAULT_SUBJECT } from '@/lib/email/default-template'
import { EmailSendError } from '@/lib/email/errors'
import { resetDb, makeUser } from './helpers'

let actor: { id: string; email: string; name: string | null }
let savedHost: string | undefined

beforeEach(async () => {
  await resetDb()
  const u = await makeUser('admin@alegra.com', 'ADMIN')
  actor = { id: u.id, email: u.email, name: u.name }
  savedHost = process.env.SMTP_HOST
})
afterEach(() => {
  if (savedHost === undefined) delete process.env.SMTP_HOST
  else process.env.SMTP_HOST = savedHost
})

const code = (c: string) => (e: unknown) => e instanceof EmailSendError && e.info.code === c

test('defaults seguros: modo webhook, sin correos de prueba', async () => {
  const s = await getSettings()
  assert.equal(s.mode, 'webhook')
  assert.deepEqual(s.testRecipients, [])
})

test('correos de prueba: solo @alegra.com, máximo 5, sin formatos raros, deduplicados', async () => {
  await assert.rejects(updateSettings(actor, { testRecipients: ['x@gmail.com'] }), code('VALIDATION'))
  await assert.rejects(updateSettings(actor, { testRecipients: ['a@alegra.com.evil.com'] }), code('VALIDATION'))
  await assert.rejects(updateSettings(actor, { testRecipients: ['no-es-correo'] }), code('VALIDATION'))
  await assert.rejects(updateSettings(actor, { testRecipients: Array.from({ length: MAX_TEST_RECIPIENTS + 1 }, (_, i) => `u${i}@alegra.com`) }), code('VALIDATION'))
  const ok = await updateSettings(actor, { testRecipients: ['A@Alegra.com', 'a@alegra.com', 'b@alegra.com'] })
  assert.deepEqual(ok.testRecipients, ['a@alegra.com', 'b@alegra.com'])
  assert.equal(ok.updatedByEmail, 'admin@alegra.com')
})

test('cambiar de modo exige lo que ese modo necesita: SMTP para test/live y correos de prueba para test', async () => {
  delete process.env.SMTP_HOST
  await assert.rejects(updateSettings(actor, { mode: 'live' }), code('SMTP_NOT_CONFIGURED'))
  await assert.rejects(updateSettings(actor, { mode: 'test', testRecipients: ['a@alegra.com'] }), code('SMTP_NOT_CONFIGURED'))
  assert.equal((await getSettings()).mode, 'webhook', 'no cambió nada')

  process.env.SMTP_HOST = 'localhost'
  await assert.rejects(updateSettings(actor, { mode: 'test' }), code('VALIDATION'))
  assert.equal((await updateSettings(actor, { mode: 'test', testRecipients: ['a@alegra.com'] })).mode, 'test')
  assert.equal((await updateSettings(actor, { mode: 'live' })).mode, 'live')
  assert.equal((await updateSettings(actor, { mode: 'shadow' })).mode, 'shadow')
  assert.equal((await updateSettings(actor, { mode: 'webhook' })).mode, 'webhook')
  await assert.rejects(updateSettings(actor, { mode: 'otro' }), code('VALIDATION'))
  await assert.rejects(updateSettings(actor, { mode: { $ne: 1 } }), code('VALIDATION'))
})

test('nombre del remitente y reply-to validados (sin inyección de cabeceras)', async () => {
  await assert.rejects(updateSettings(actor, { fromName: 'Evil\r\nBcc: x@y.com' }), code('VALIDATION'))
  await assert.rejects(updateSettings(actor, { fromName: 'A <b@c.com>' }), code('VALIDATION'))
  await assert.rejects(updateSettings(actor, { fromName: '' }), code('VALIDATION'))
  await assert.rejects(updateSettings(actor, { replyTo: 'a@b.com, c@d.com' }), code('VALIDATION'))
  await assert.rejects(updateSettings(actor, { replyTo: 'x@y.com\r\nBcc: z@w.com' }), code('VALIDATION'))
  const ok = await updateSettings(actor, { fromName: 'Alegra Product News', replyTo: 'Respuestas@Alegra.com' })
  assert.equal(ok.replyTo, 'respuestas@alegra.com')
  assert.equal((await updateSettings(actor, { replyTo: null })).replyTo, null)
  await assert.rejects(updateSettings(actor, {}), code('VALIDATION'))
})

test('los cambios de configuración quedan auditados', async () => {
  process.env.SMTP_HOST = 'localhost'
  await updateSettings(actor, { mode: 'shadow' })
  const a = await prisma.auditLog.findFirstOrThrow({ where: { action: 'EMAIL_SETTINGS_UPDATED' } })
  assert.deepEqual(a.details, { changed: ['mode'], from: 'webhook', to: 'shadow' })
})

test('plantilla: sin editar usa la que viene con la app; al editar versiona y archiva la original', async () => {
  const t0 = await getActiveTemplate()
  assert.equal(t0.isDefault, true)
  assert.equal(t0.html, DEFAULT_HTML)

  const t1 = await saveTemplate(actor, { subject: 'Asunto {{titulo}}', html: '<p>{{titulo}}</p>' })
  assert.equal(t1.isDefault, false)
  assert.equal(t1.version, 2)
  const revs = await listRevisions()
  assert.deepEqual(revs.map((r) => [r.version, r.isActive]), [[2, true], [1, false]])

  const t2 = await saveTemplate(actor, { subject: 'Otro {{titulo}}', html: '<p>v3 {{titulo}}</p>' })
  assert.equal(t2.version, 3)
})

test('restaurar una versión crea una versión nueva (el historial solo crece); restaurar por defecto vuelve a la original', async () => {
  await saveTemplate(actor, { subject: 'A', html: '<p>A</p>' })
  await saveTemplate(actor, { subject: 'B', html: '<p>B</p>' })
  const back = await restoreRevision(actor, 2)
  assert.equal(back.html, '<p>A</p>')
  assert.equal(back.version, 4)
  const def = await restoreDefault(actor)
  assert.equal(def.html, DEFAULT_HTML)
  assert.equal(def.subject, DEFAULT_SUBJECT)
  assert.equal(def.version, 5)
  assert.equal((await listRevisions()).length, 5)
  await assert.rejects(restoreRevision(actor, 99), code('NOT_FOUND'))
})

test('una plantilla inválida se rechaza y no cambia nada', async () => {
  await assert.rejects(saveTemplate(actor, { subject: 'x', html: '<p>{{{titulo}}}</p>' }), code('TEMPLATE'))
  await assert.rejects(saveTemplate(actor, { subject: '{{#if x}}', html: '<p>ok</p>' }), code('TEMPLATE'))
  await assert.rejects(saveTemplate(actor, { subject: 'x', html: '{{> parcial}}' }), code('TEMPLATE'))
  await assert.rejects(saveTemplate(actor, { subject: 'x', html: 123 }), code('VALIDATION'))
  assert.equal((await getActiveTemplate()).isDefault, true)
  assert.equal(await prisma.emailTemplateRevision.count(), 0)
})

test('guardados simultáneos no duplican versiones', async () => {
  await Promise.all(Array.from({ length: 6 }, (_, i) => saveTemplate(actor, { subject: `s${i}`, html: `<p>${i}</p>` })))
  const versions = (await listRevisions()).map((r) => r.version).sort((a, b) => a - b)
  assert.deepEqual(versions, [1, 2, 3, 4, 5, 6, 7])
})
