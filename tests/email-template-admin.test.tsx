import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString as render } from 'react-dom/server'
import {
  previewTemplate, saveTemplateRun, restoreDefaultRun, restoreRevisionRun, getRevisionRun, getTemplateState, listRecentNovedades,
} from '@/lib/email/admin'
import { DEFAULT_HTML, DEFAULT_SUBJECT } from '@/lib/email/default-template'
import { EditorBody } from '@/components/email/template-editor'
import { resetDb, makeUser, ensureFields } from './helpers'
import { makeRecord } from './email-helpers'

let actor: { id: string; email: string; name: string | null }

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  const u = await makeUser('admin@alegra.com', 'ADMIN')
  actor = { id: u.id, email: u.email, name: u.name }
})

const draft = { subject: '{{titulo}} — {{producto}}', html: '<h1>{{titulo}}</h1><p>{{descripcion}}</p>' }

test('vista previa con datos de ejemplo: renderiza el borrador sin guardarlo', async () => {
  const r = await previewTemplate(draft)
  assert.ok(r.ok)
  assert.equal(r.data.source, 'sample')
  assert.equal(r.data.subject, 'Conciliación bancaria automática — Alegra Contabilidad')
  assert.match(r.data.html, /<h1>Conciliación bancaria automática<\/h1>/)
  assert.equal((await getTemplateState()).template.isDefault, true, 'la vista previa no guarda nada')
})

test('vista previa con una novedad real: usa sus datos y escapa lo peligroso', async () => {
  const rec = await makeRecord({ titulo: '<img src=x onerror=alert(1)>', breveDescripcion: 'Texto <b>con</b> HTML' })
  const r = await previewTemplate({ ...draft, recordId: rec.id })
  assert.ok(r.ok)
  assert.equal(r.data.source, 'record')
  assert.ok(!r.data.html.includes('<img'), 'la etiqueta inyectada no puede quedar como HTML real')
  assert.ok(r.data.html.includes('&lt;img src'))
  assert.ok(r.data.html.includes('Texto &lt;b&gt;con&lt;/b&gt; HTML'))
})

test('vista previa: errores de plantilla y de registro llegan como mensaje, nunca como excepción', async () => {
  const cases: [unknown, string][] = [
    [{ subject: 'x', html: '<p>{{{titulo}}}</p>' }, 'TEMPLATE'],
    [{ subject: 'x', html: '{{#if titulo}}sin cerrar' }, 'TEMPLATE'],
    [{ subject: '', html: '<p>x</p>' }, 'TEMPLATE'],
    [{ subject: 'x', html: 'x'.repeat(200_001) }, 'TEMPLATE'],
    [{ subject: 5, html: 'x' }, 'VALIDATION'],
    [{ ...draft, recordId: 'no-existe' }, 'NOT_FOUND'],
    [{ ...draft, recordId: "' OR 1=1--" }, 'NOT_FOUND'],
    [{ ...draft, recordId: String.fromCharCode(0) }, 'NOT_FOUND'],
  ]
  for (const [input, code] of cases) {
    const r = await previewTemplate(input as Parameters<typeof previewTemplate>[0])
    assert.ok(!r.ok, JSON.stringify(input).slice(0, 60))
    assert.equal(r.code, code, JSON.stringify(input).slice(0, 60))
  }
})

test('plantilla con intento de SSTI no filtra nada en la vista previa', async () => {
  const r = await previewTemplate({ subject: 'x', html: '{{constructor.constructor}}|{{__proto__}}|{{lookup this "constructor"}}' })
  assert.ok(r.ok)
  assert.ok(!/function|\[object/.test(r.data.html))
})

test('guardar → versión nueva; el envío usa lo guardado; restaurar mantiene el historial', async () => {
  const s1 = await saveTemplateRun(actor, draft)
  assert.ok(s1.ok && s1.data.version === 2)
  const s2 = await saveTemplateRun(actor, { subject: 'otro', html: '<p>v3</p>' })
  assert.ok(s2.ok && s2.data.version === 3)

  const old = await getRevisionRun(2)
  assert.ok(old.ok && old.data.html === draft.html)
  const back = await restoreRevisionRun(actor, 2)
  assert.ok(back.ok && back.data.version === 4 && back.data.html === draft.html)
  const def = await restoreDefaultRun(actor)
  assert.ok(def.ok && def.data.html === DEFAULT_HTML && def.data.subject === DEFAULT_SUBJECT)

  const state = await getTemplateState()
  assert.equal(state.revisions.length, 5)
  assert.ok(state.variables.some((v) => v.name === 'titulo' && !v.optional))
  assert.equal(state.defaults.html, DEFAULT_HTML)
})

test('guardar rechaza plantillas inválidas con el motivo y no versiona', async () => {
  const bad = await saveTemplateRun(actor, { subject: 'x', html: '{{> parcial}}' })
  assert.ok(!bad.ok && bad.code === 'TEMPLATE' && /parciales/.test(bad.error))
  assert.equal((await getTemplateState()).revisions.length, 0)
  const missing = await getRevisionRun(99)
  assert.ok(!missing.ok && missing.code === 'NOT_FOUND')
  for (const bad of ['abc', -1, 0, 1.5, null, undefined, {}]) {
    const r = await restoreRevisionRun(actor, bad)
    assert.ok(!r.ok && r.code === 'NOT_FOUND', String(bad))
  }
})

test('selector de novedades: todos los tipos, más recientes primero, acotado', async () => {
  await makeRecord({ titulo: 'Vieja' }, new Date('2026-11-01T10:00:00Z'))
  await makeRecord({ titulo: 'Mejora x', tipo: 'Mejora' }, new Date('2026-11-02T10:00:00Z'))
  await makeRecord({ titulo: 'Reciente', tipo: 'Pre-novedad' }, new Date('2026-11-03T10:00:00Z'))
  const list = await listRecentNovedades()
  assert.deepEqual(list.map((n) => n.titulo), ['Reciente', 'Mejora x', 'Vieja'])
  assert.equal((await listRecentNovedades(1)).length, 1)
})

test('editor: muestra el contenido, las variables, las versiones y el selector de novedades', async () => {
  await saveTemplateRun(actor, draft)
  const state = await getTemplateState()
  const h = render(<EditorBody initial={state} novedades={[{ id: 'r1', titulo: 'Mi novedad', tipo: 'Novedad', createdAt: '2026-10-20T00:00:00Z' }]} onReload={async () => {}} />).replace(/<!-- -->/g, '')
  for (const t of ['versión 2', 'Guardar como versión nueva', 'Restaurar la original', 'Datos de ejemplo', 'Mi novedad (Novedad)', 'v2', 'v1', 'Cargar en el editor', 'no se permite HTML sin escapar']) {
    assert.ok(h.includes(t), `falta "${t}"`)
  }
  assert.ok(h.includes('value="{{titulo}} — {{producto}}"') || h.includes('{{titulo}} — {{producto}}'))
  assert.ok(h.includes('<iframe') === false, 'la vista previa se genera en el cliente, no en el render inicial')
})
