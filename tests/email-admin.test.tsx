import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString as render } from 'react-dom/server'
import { getAdminState, saveSettings, verifyConnection } from '@/lib/email/admin'
import { setTransportFactory } from '@/lib/email/transport'
import { SettingsPanel } from '@/components/email/email-admin'
import { prisma } from '@/lib/prisma'
import { resetDb, makeUser, ensureFields } from './helpers'
import { makeWebhookButton } from './email-helpers'

let actor: { id: string; email: string; name: string | null }
const ENV = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_PASS', 'PMKT_CHAT_WEBHOOK_URL'] as const
let saved: Record<string, string | undefined>

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  await prisma.field.deleteMany({ where: { type: 'button' } })
  const u = await makeUser('admin@alegra.com', 'ADMIN')
  actor = { id: u.id, email: u.email, name: u.name }
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  setTransportFactory(null)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

test('estado de administración: sin contraseñas ni llaves de webhooks; el host de Chat sí', async () => {
  process.env.SMTP_PASS = 'clave-de-aplicacion-secreta'
  process.env.PMKT_CHAT_WEBHOOK_URL = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=LLAVE-SECRETA&token=TOKEN-SECRETO'
  const state = await getAdminState()
  const dump = JSON.stringify(state)
  for (const secret of ['clave-de-aplicacion-secreta', 'LLAVE-SECRETA', 'TOKEN-SECRETO', 'spaces/AAA']) assert.ok(!dump.includes(secret), `se filtró ${secret}`)
  assert.equal(state.smtp.hasPassword, true)
  assert.equal(state.chat.configured, true)
  assert.equal(state.chat.host, 'chat.googleapis.com')
  assert.deepEqual(state.modes.map((m) => m.id), ['webhook', 'shadow', 'test', 'live'])
  assert.deepEqual(state.limits.testDomains, ['alegra.com'])
  assert.equal(state.appUrl, 'https://bitacora.test')
})

test('estado: detecta si el botón del Apps Script está configurado', async () => {
  assert.equal((await getAdminState()).webhook.configured, false)
  await makeWebhookButton('http://127.0.0.1:9/hook')
  assert.equal((await getAdminState()).webhook.configured, true)
})

test('guardar: devuelve el error como resultado (no lanza) y aplica cambios válidos', async () => {
  const bad = await saveSettings(actor, { testRecipients: ['x@gmail.com'] })
  assert.ok(!bad.ok && bad.code === 'VALIDATION' && /@alegra.com/.test(bad.error))
  delete process.env.SMTP_HOST
  const noSmtp = await saveSettings(actor, { mode: 'live' })
  assert.ok(!noSmtp.ok && noSmtp.code === 'SMTP_NOT_CONFIGURED')
  process.env.SMTP_HOST = 'localhost'
  const ok = await saveSettings(actor, { mode: 'test', testRecipients: 'yo@alegra.com' })
  assert.ok(ok.ok && ok.data.mode === 'test' && ok.data.testRecipients[0] === 'yo@alegra.com')
})

test('verificar conexión: ok contra el SMTP local; error clasificado si no responde o falta configurar', async () => {
  const ok = await verifyConnection()
  assert.ok(ok.ok && ok.data.ok)
  process.env.SMTP_PORT = '9'
  const down = await verifyConnection()
  assert.ok(down.ok && !down.data.ok && down.data.code === 'CONNECTION')
  delete process.env.SMTP_HOST
  const none = await verifyConnection()
  assert.ok(none.ok && !none.data.ok && none.data.code === 'SMTP_NOT_CONFIGURED')
})

test('guardia: toda acción de servidor de correo-admin exige ADMIN antes de hacer nada', () => {
  const dir = join(process.cwd(), 'src/lib/actions')
  const files = readdirSync(dir).filter((f) => /^email-admin.*\.ts$/.test(f))
  assert.ok(files.length >= 1)
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8').split(String.fromCharCode(13)).join('')
    assert.ok(src.startsWith("'use server'"), `${f} debe ser 'use server'`)
    const chunks = src.split(/\nexport async function /).slice(1)
    assert.ok(chunks.length > 0)
    for (const chunk of chunks) {
      const name = chunk.slice(0, chunk.indexOf('('))
      const body = chunk.slice(0, chunk.indexOf('\n}\n') + 3)
      assert.match(body, /await (requireAdmin|admin)\(\)/, `${f}: ${name} no exige ADMIN`)
    }
  }
})

const baseState = (over: Record<string, unknown> = {}) => ({
  settings: { mode: 'webhook', fromName: 'Alegra Product News', replyTo: null, testRecipients: [], recipients: [{ email: 'cristian.albornoz@alegra.com', name: 'Cristian Albornoz Arias' }, { email: 'valentina.garcia@alegra.com' }], recipientsCustomized: false, updatedAt: null, updatedByEmail: null },
  smtp: { configured: false, host: null, port: 587, user: 'data.news@alegra.com', fromEmail: 'data.news@alegra.com', hasPassword: false, missing: ['SMTP_HOST', 'SMTP_PASS'] },
  chat: { configured: true, host: 'chat.googleapis.com', testWebhookConfigured: false },
  itHub: { configured: true },
  webhook: { configured: true },
  modes: [{ id: 'webhook', label: 'a' }, { id: 'shadow', label: 'b' }, { id: 'test', label: 'c' }, { id: 'live', label: 'd' }],
  limits: { maxTestRecipients: 5, testDomains: ['alegra.com'] },
  appUrl: 'https://bitacora-novedades.alegra.com',
  ...over,
}) as unknown as Parameters<typeof SettingsPanel>[0]['state']

test('pantalla de configuración: advierte lo que falta y nunca muestra la contraseña', () => {
  const h = render(<SettingsPanel state={baseState()} onChange={() => {}} />).replace(/<!-- -->/g, '')
  for (const t of ['Modo de envío', 'Apps Script (legado)', 'Sombra', 'Falta configurar', 'SMTP_HOST, SMTP_PASS', 'No cargada', 'Personas a etiquetar en Chat', 'cristian.albornoz@alegra.com', 'lista por defecto', 'Verificar conexión', 'chat.googleapis.com', 'Requiere el SMTP configurado']) {
    assert.ok(h.includes(t), `falta "${t}"`)
  }
  const ok = render(<SettingsPanel state={baseState({ smtp: { configured: true, host: 'smtp.gmail.com', port: 587, user: 'data.news@alegra.com', fromEmail: 'data.news@alegra.com', hasPassword: true, missing: [] } })} onChange={() => {}} />).replace(/<!-- -->/g, '')
  assert.ok(ok.includes('Cargada (no se muestra)') && ok.includes('smtp.gmail.com:587'))
  assert.ok(!ok.includes('Requiere el SMTP configurado'))
})
