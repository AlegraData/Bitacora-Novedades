import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString as render } from 'react-dom/server'
import { EmailResultBanner, EmailPreviewModal, EmailHistory } from '@/components/email/email-panels'
import type { SendResult } from '@/lib/email/service'

const noop = () => {}
const html = (el: Parameters<typeof render>[0]) => render(el).replace(/<!-- -->/g, '')
const banner = (result: SendResult, over: { isAdmin?: boolean; retry?: boolean; preview?: boolean } = {}) =>
  html(<EmailResultBanner result={result} isAdmin={over.isAdmin ?? false} onClose={noop} onRetry={over.retry === false ? undefined : noop} onPreview={over.preview === false ? undefined : noop} />)

test('enviado: muestra asunto, destinatarios y el estado del aviso a Chat', () => {
  const h = banner({ ok: true, status: 'sent', mode: 'live', subject: 'Novedad | POS - X', recipients: ['a@alegra.com', 'b@alegra.com'], chat: 'sent' })
  for (const t of ['Correo enviado', 'Novedad | POS - X', 'a@alegra.com, b@alegra.com', 'avisado en el canal']) assert.ok(h.includes(t), t)
  assert.ok(!h.includes('Reintentar'))
})

test('el modo prueba y el Apps Script se identifican (nadie cree que llegó a los destinatarios reales)', () => {
  assert.ok(banner({ ok: true, status: 'sent', mode: 'test', recipients: ['yo@alegra.com'] }).includes('modo prueba'))
  assert.ok(banner({ ok: true, status: 'sent', mode: 'webhook', recipients: ['a@alegra.com'] }).includes('Apps Script'))
})

test('un fallo de Chat no se presenta como fallo del correo', () => {
  const h = banner({ ok: true, status: 'sent', mode: 'live', recipients: ['a@alegra.com'], chat: 'failed' })
  assert.ok(h.includes('Correo enviado'))
  assert.ok(h.includes('el correo sí salió'))
})

test('faltan datos: lista exacta de campos, direcciones inválidas y sin botón de reintento', () => {
  const h = banner({ ok: false, status: 'failed', error: { code: 'VALIDATION', message: 'No se puede comunicar todavía: faltan datos obligatorios.', missingFields: ['Responsables', 'Fecha real de producción'], invalidRecipients: ['mal'] } })
  for (const t of ['Faltan datos para enviar', 'Completa estos campos', 'Responsables', 'Fecha real de producción', 'Direcciones inválidas', 'mal']) assert.ok(h.includes(t), t)
  assert.ok(!h.includes('Reintentar'), 'reintentar sin corregir no sirve')
})

test('duplicado: dice quién y cuándo lo envió y no ofrece reintentar', () => {
  const h = banner({ ok: false, status: 'failed', error: { code: 'DUPLICATE', message: 'Esta novedad ya se comunicó antes.', previous: { deliveryId: '1', sentAt: '2026-10-20T15:00:00Z', by: 'ana@alegra.com' } } })
  assert.ok(h.includes('Ya se envió antes') && h.includes('ana@alegra.com'))
  assert.ok(!h.includes('Reintentar'))
})

test('errores de servidor sí ofrecen reintentar; con rechazados los lista', () => {
  for (const code of ['SMTP_AUTH', 'CONNECTION', 'TIMEOUT', 'RATE_LIMIT', 'WEBHOOK'] as const) {
    assert.ok(banner({ ok: false, status: 'failed', error: { code, message: 'x' } }).includes('Reintentar'), code)
  }
  const h = banner({ ok: false, status: 'failed', error: { code: 'RECIPIENT_REJECTED', message: 'rechazó', rejectedRecipients: ['no@alegra.com'] } })
  assert.ok(h.includes('Rechazadas por el servidor') && h.includes('no@alegra.com'))
  assert.ok(!banner({ ok: false, status: 'failed', error: { code: 'SMTP_AUTH', message: 'x' } }, { retry: false }).includes('Reintentar'))
})

test('detalle técnico: solo el ADMIN tiene el botón para verlo; el usuario normal nunca', () => {
  const failed: SendResult = { ok: false, status: 'failed', error: { code: 'SMTP_AUTH', message: 'No se pudo autenticar', detail: '535 5.7.8 rechazado' } }
  assert.ok(banner(failed, { isAdmin: true }).includes('Ver detalle técnico'))
  assert.ok(!banner(failed, { isAdmin: false }).includes('Ver detalle técnico'))
  assert.ok(!banner(failed, { isAdmin: false }).includes('535'))
})

test('simulacro: aclara que no se envió nada y ofrece ver el correo', () => {
  const h = banner({ ok: true, status: 'simulated', mode: 'simulate', subject: 'S', recipients: ['a@alegra.com'], warnings: ['Se omitieron direcciones con formato inválido: x'] })
  for (const t of ['no se envió nada', 'Ver el correo', 'Se omitieron direcciones']) assert.ok(h.includes(t), t)
})

test('vista previa: iframe en sandbox sin permisos y el HTML llega escapado dentro de srcDoc', () => {
  const h = html(<EmailPreviewModal result={{ ok: true, status: 'simulated', subject: 'Asunto', recipients: ['a@alegra.com'], html: '<p>hola</p><script>alert(1)</script>' }} onClose={noop} />)
  assert.match(h, /<iframe[^>]*sandbox=""/)
  assert.ok(!h.includes('<script>alert(1)</script>'), 'el script no queda como etiqueta real en la página')
  assert.ok(h.includes('&lt;p&gt;hola&lt;/p&gt;'))
  assert.ok(h.includes('Asunto') && h.includes('a@alegra.com'))
})

test('historial: cerrado por defecto (no consulta nada hasta que se abre)', () => {
  const h = html(<EmailHistory recordId="r1" />)
  assert.ok(h.includes('Historial de envíos'))
  assert.ok(!h.includes('Cargando'))
})

test('duplicado: el ADMIN ve «Reenviar como ADMIN» (aunque el botón de la novedad esté en «No»); el usuario normal no', () => {
  const dup: SendResult = { ok: false, status: 'failed', error: { code: 'DUPLICATE', message: 'Esta novedad ya se comunicó antes. Solo un ADMIN puede reenviarla.', previous: { deliveryId: 'legacy:1', sentAt: '2026-10-16T21:18:53Z', by: 'juan.alvarez@alegra.com' } } }
  const withResend = (isAdmin: boolean) => html(<EmailResultBanner result={dup} isAdmin={isAdmin} onClose={noop} onResend={noop} />)

  const admin = withResend(true)
  assert.ok(admin.includes('Reenviar como ADMIN'))
  assert.ok(admin.includes('Como ADMIN puedes reenviarla indicando el motivo'))
  assert.ok(admin.includes('juan.alvarez@alegra.com'), 'sigue diciendo quién lo envió antes')

  const user = withResend(false)
  assert.ok(!user.includes('Reenviar como ADMIN'))
  assert.ok(user.includes('Solo un ADMIN puede reenviarla'))

  // sin handler (p. ej. el aviso del auto-guardado) no hay botón aunque sea ADMIN
  assert.ok(!html(<EmailResultBanner result={dup} isAdmin onClose={noop} />).includes('Reenviar como ADMIN'))
  // otros errores no ofrecen reenvío
  assert.ok(!html(<EmailResultBanner result={{ ok: false, status: 'failed', error: { code: 'VALIDATION', message: 'x' } }} isAdmin onClose={noop} onResend={noop} />).includes('Reenviar como ADMIN'))
})
