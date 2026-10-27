import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { normalizeRecipients, recipientsOrDefault, mentionable, RecipientsError, DEFAULT_NOTIFY_RECIPIENTS, MAX_NOTIFY_RECIPIENTS } from '@/lib/email/recipients'
import { getSettings, updateSettings } from '@/lib/email/settings'
import { EmailSendError } from '@/lib/email/errors'
import { sendNovedad } from '@/lib/email/service'
import { resetDb, makeUser, ensureFields } from './helpers'
import { clearMailbox, getMessage, listMessages } from './mailpit'
import { viewer, makeRecord, setMode } from './email-helpers'

let actor: { id: string; email: string; name: string | null }

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  await clearMailbox()
  const u = await makeUser('admin@alegra.com', 'ADMIN')
  actor = { id: u.id, email: u.email, name: u.name }
})

const code = (c: string) => (e: unknown) => e instanceof EmailSendError && e.info.code === c

test('por defecto el destinatario es el grupo tm-alegra, sin menciones (decisión final de PMKT)', async () => {
  assert.deepEqual(DEFAULT_NOTIFY_RECIPIENTS, [{ email: 'tm-alegra@alegra.com', name: 'TM Alegra', mention: false }])
  const s = await getSettings()
  assert.equal(s.recipientsCustomized, false)
  assert.deepEqual(s.recipients.map((r) => r.email), ['tm-alegra@alegra.com'])
  assert.deepEqual(mentionable(s.recipients), [], 'a nadie se le menciona en Chat')
})

test('«Mencionar en Chat»: mention:false se conserva al guardar y mentionable() lo excluye; sin marca se menciona', async () => {
  const r = normalizeRecipients([{ email: 'grupo@alegra.com', mention: false }, { email: 'ana@alegra.com', mention: true }, { email: 'luis@alegra.com' }, { email: 'x@alegra.com', mention: 'no' }])
  assert.deepEqual(r, [{ email: 'grupo@alegra.com', mention: false }, { email: 'ana@alegra.com' }, { email: 'luis@alegra.com' }, { email: 'x@alegra.com' }])
  assert.deepEqual(mentionable(r).map((x) => x.email), ['ana@alegra.com', 'luis@alegra.com', 'x@alegra.com'])
  const saved = await updateSettings(actor, { recipients: [{ email: 'grupo@alegra.com', mention: false }, { email: 'ana@alegra.com' }] })
  assert.deepEqual(saved.recipients, [{ email: 'grupo@alegra.com', mention: false }, { email: 'ana@alegra.com' }])
  assert.equal((await getSettings()).recipients[0].mention, false, 'persiste')
})

test('normalizeRecipients: minúsculas, sin duplicados, nombre sin marcas de Chat, ID numérico', () => {
  const r = normalizeRecipients([
    { email: ' Ana@Alegra.com ', name: ' *Ana*  <b>Gómez</b> ', chatUserId: '105277208503173878668' },
    { email: 'ana@alegra.com' },
    { email: 'luis@alegra.com', chatUserId: '' },
  ])
  assert.deepEqual(r, [{ email: 'ana@alegra.com', name: 'Ana bGómez/b', chatUserId: '105277208503173878668' }, { email: 'luis@alegra.com' }])
})

test('normalizeRecipients rechaza lo inválido con el motivo', () => {
  const bad: unknown[] = [
    [], null, 'a@b.com', [{ email: 'no-es-correo' }], [{ email: 'a@alegra.com\r\nBcc: x@y.com' }], [{ email: 'a@b.com, c@d.com' }],
    [{ email: 'a@alegra.com', chatUserId: 'abc' }], [{ email: 'a@alegra.com', chatUserId: '12' }], [{ email: 'a@alegra.com', chatUserId: '<users/all>' }],
    Array.from({ length: MAX_NOTIFY_RECIPIENTS + 1 }, (_, i) => ({ email: `u${i}@alegra.com` })),
  ]
  for (const input of bad) assert.throws(() => normalizeRecipients(input), RecipientsError, JSON.stringify(input).slice(0, 50))
  assert.deepEqual(recipientsOrDefault(null), DEFAULT_NOTIFY_RECIPIENTS)
  assert.deepEqual(recipientsOrDefault('basura'), DEFAULT_NOTIFY_RECIPIENTS)
  assert.deepEqual(recipientsOrDefault([]), DEFAULT_NOTIFY_RECIPIENTS)
})

test('el admin guarda los destinatarios (persisten, se auditan) y rechaza listas inválidas sin tocar nada', async () => {
  const ok = await updateSettings(actor, { recipients: [{ email: 'uno@alegra.com', name: 'Uno', chatUserId: '111111111111111111111' }, { email: 'dos@alegra.com' }] })
  assert.equal(ok.recipientsCustomized, true)
  assert.deepEqual(ok.recipients.map((r) => r.email), ['uno@alegra.com', 'dos@alegra.com'])
  assert.equal((await getSettings()).recipients[0].chatUserId, '111111111111111111111')
  assert.deepEqual((await prisma.auditLog.findFirstOrThrow({ where: { action: 'EMAIL_SETTINGS_UPDATED' } })).details, { changed: ['notifyRecipients'] })

  for (const bad of [[], [{ email: 'x' }], 'nada', [{ email: 'a@alegra.com', chatUserId: 'x' }]]) {
    await assert.rejects(updateSettings(actor, { recipients: bad }), code('VALIDATION'))
  }
  assert.deepEqual((await getSettings()).recipients.map((r) => r.email), ['uno@alegra.com', 'dos@alegra.com'])
})

test('el correo va SOLO a los destinatarios configurados (tm-alegra), aunque el registro traiga otros', async () => {
  await setMode('live')
  const r = await makeRecord({ correosAComunicar: ['otro@alegra.com', 'otro2@alegra.com'] })
  const res = await sendNovedad({ recordId: r.id, actor: viewer, channel: 'web', trigger: 'manual' })
  assert.equal(res.status, 'sent')
  assert.deepEqual(res.recipients, ['tm-alegra@alegra.com'])

  const mail = await getMessage((await listMessages())[0].ID)
  assert.deepEqual(mail.To.map((t) => t.Address), ['tm-alegra@alegra.com'])
  assert.ok(!JSON.stringify([mail.To, mail.Cc, mail.Bcc]).includes('otro'))
})

test('«Correos a comunicar» vacío ya no impide enviar; cambiar la lista en el admin se aplica al instante', async () => {
  await setMode('live')
  await updateSettings(actor, { recipients: [{ email: 'solo.yo@alegra.com' }] })
  const r = await makeRecord({ correosAComunicar: [] })
  const res = await sendNovedad({ recordId: r.id, actor: viewer, channel: 'web', trigger: 'manual' })
  assert.equal(res.status, 'sent')
  const mail = await getMessage((await listMessages())[0].ID)
  assert.deepEqual(mail.To.map((t) => t.Address), ['solo.yo@alegra.com'])
})

test('el simulacro muestra los destinatarios reales de la notificación', async () => {
  const r = await makeRecord({ correosAComunicar: ['otro@alegra.com'] })
  const sim = await sendNovedad({ recordId: r.id, actor: viewer, channel: 'web', trigger: 'manual', simulate: true })
  assert.deepEqual(sim.recipients, ['tm-alegra@alegra.com'])
})
