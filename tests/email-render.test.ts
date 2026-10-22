import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_HTML, DEFAULT_SUBJECT } from '@/lib/email/default-template'
import { buildVariables, safeUrl, sampleVariables, type EmailVariables } from '@/lib/email/variables'
import { renderEmail, renderSubject, validateTemplate, htmlToText, TemplateError, MAX_TEMPLATE_CHARS } from '@/lib/email/render'

const tpl = { subject: DEFAULT_SUBJECT, html: DEFAULT_HTML }
const full: Record<string, unknown> = {
  tipo: 'Novedad', titulo: 'Mi novedad', breveDescripcion: 'Una descripción', fechaLanzamiento: '2026-11-15',
  elaborado: ['ana@alegra.com'], responsables: ['a@alegra.com', 'b@alegra.com'], version: ['v1', 'v2'],
  producto: ['Alegra POS'], sh: 'Contabilidad', documentacionOnePager: 'https://wiki.alegra.com/doc/x', video: 'https://youtu.be/x',
}
const norm = (s: string) => htmlToText(s).replace(/\s+/g, ' ').trim()

test('registro completo: asunto con el formato legado y todos los datos en el cuerpo', () => {
  const r = renderEmail(tpl, buildVariables(full, 'rec1'))
  assert.equal(r.subject, 'Novedad | Alegra POS - Mi novedad')
  for (const t of ['Una descripción', 'v1, v2', '2026-11-15', 'Contabilidad', 'a@alegra.com, b@alegra.com', 'Video / Ayuda', 'WikiAlegra']) {
    assert.ok(r.html.includes(t), `falta ${t}`)
  }
  // Handlebars escapa "=" dentro del atributo (&#x3D;): HTML válido; en texto plano se ve normal.
  assert.ok(r.text.includes('https://bitacora.test/app?record=rec1'), 'link con APP_PUBLIC_URL, no el dominio viejo de Vercel')
  assert.ok(!r.html.includes('vercel.app'))
})

test('opcionales ausentes se omiten: nunca "undefined", "null" ni links vacíos', () => {
  const r = renderEmail(tpl, buildVariables({ titulo: 'Solo título' }, 'r2'))
  assert.equal(r.subject, 'Solo título')
  for (const bad of ['undefined', 'null', '[object', 'href=""', 'Video / Ayuda', 'Descripción:', 'Versión:', 'Sh encargado', 'documentación']) {
    assert.ok(!r.html.includes(bad), `no debería contener ${bad}`)
  }
  assert.ok(r.html.includes('Quedamos atentos'))
  assert.ok(r.html.includes('WikiAlegra'), 'el link a la bitácora siempre está')
})

test('valores "N/A", "No aplica", "Ninguno", vacíos y arreglos vacíos cuentan como ausentes', () => {
  const v = buildVariables({ titulo: 'T', tipo: 'N/A', producto: [], sh: ' No aplica ', version: ['ninguno'], breveDescripcion: '', responsables: ['', 'n/a'] }, 'r')
  assert.equal(v.tipo, undefined)
  assert.equal(v.producto, undefined)
  assert.equal(v.sh, undefined)
  assert.equal(v.versiones, undefined)
  assert.equal(v.descripcion, undefined)
  assert.equal(v.responsables, undefined)
})

test('sin documentación se omite la frase del link; con ella aparece', () => {
  const sin = renderEmail(tpl, buildVariables({ titulo: 'T' }, 'r'))
  const con = renderEmail(tpl, buildVariables({ titulo: 'T', documentacionOnePager: 'https://x.com/d' }, 'r'))
  assert.ok(!sin.html.includes('Les compartimos'))
  assert.ok(con.html.includes('Les compartimos la') && con.html.includes('https://x.com/d'))
})

test('XSS: el HTML de los datos se escapa en cuerpo y atributos', () => {
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>'
  const r = renderEmail(tpl, buildVariables({ ...full, titulo: evil, breveDescripcion: evil, sh: evil, responsables: [evil] }, 'r'))
  assert.ok(!r.html.includes('<script>alert'), 'script sin escapar')
  assert.ok(!r.html.includes('<img src=x'), 'img inyectada')
  assert.ok(r.html.includes('&lt;script&gt;'))

  const attr = renderEmail(tpl, buildVariables({ ...full, video: 'https://a.com/"onmouseover="alert(1)' }, 'r'))
  assert.ok(!/href="[^"]*"onmouseover/.test(attr.html), 'no debe poder romper el atributo href')
})

test('URLs peligrosas no llegan al href', () => {
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd', '//evil.com', 'ftp://x']) {
    assert.equal(safeUrl(bad), undefined, bad)
  }
  assert.ok(safeUrl('https://ok.com/a?b=1'))
  const r = renderEmail(tpl, buildVariables({ ...full, video: 'javascript:alert(1)', documentacionOnePager: 'data:text/html,x' }, 'r'))
  assert.ok(!/javascript:|data:text/i.test(r.html))
  assert.ok(!r.html.includes('Video / Ayuda'))
})

test('el asunto es de una sola línea (sin inyección de cabeceras) y acotado', () => {
  const v = buildVariables({ titulo: 'Hola\r\nBcc: evil@x.com\nSubject: x', tipo: 'Novedad' }, 'r')
  const s = renderSubject(DEFAULT_SUBJECT, v)
  assert.ok(!/[\r\n]/.test(s))
  assert.ok(renderSubject(DEFAULT_SUBJECT, buildVariables({ titulo: 'x'.repeat(5000) }, 'r')).length <= 200)
  // el asunto no escapa HTML (no debe verse "&amp;" en la bandeja)
  assert.equal(renderSubject(DEFAULT_SUBJECT, buildVariables({ titulo: 'Compras & Ventas' }, 'r')), 'Compras & Ventas')
})

test('validación de plantilla: sin HTML crudo, parciales, decoradores, vacía, enorme o con error de sintaxis', () => {
  assert.throws(() => validateTemplate('<p>{{{titulo}}}</p>'), (e) => e instanceof TemplateError && /sin escapar/.test(e.message))
  assert.throws(() => validateTemplate('<p>{{& titulo}}</p>'), TemplateError)
  assert.throws(() => validateTemplate('{{> otraPlantilla}}'), (e) => e instanceof TemplateError && /parciales/.test(e.message))
  assert.throws(() => validateTemplate('{{#> bloque}}x{{/bloque}}'), TemplateError)
  assert.throws(() => validateTemplate('{{*decorador}}'), TemplateError)
  assert.throws(() => validateTemplate('   '), TemplateError)
  assert.throws(() => validateTemplate('x'.repeat(MAX_TEMPLATE_CHARS + 1)), TemplateError)
  assert.throws(() => validateTemplate('{{#if titulo}}sin cerrar'), (e) => e instanceof TemplateError && /sintaxis/.test(e.message))
  assert.doesNotThrow(() => validateTemplate(DEFAULT_HTML))
  assert.doesNotThrow(() => validateTemplate(DEFAULT_SUBJECT))
})

test('SSTI: no se puede llegar a prototipos ni constructores desde la plantilla', () => {
  const attempts = [
    '{{constructor}}', '{{__proto__}}', '{{constructor.constructor}}', '{{lookup this "constructor"}}',
    '{{#with constructor}}{{name}}{{/with}}', '{{this.constructor.name}}', '{{toString}}', '{{hasOwnProperty}}',
  ]
  for (const a of attempts) {
    const out = renderEmail({ subject: 'x', html: a }, sampleVariables()).html
    assert.ok(!/function|\[object|Object|native code/.test(out), `${a} → ${out}`)
  }
})

test('texto plano: sin etiquetas, con los links visibles y sin el CSS', () => {
  const r = renderEmail(tpl, buildVariables(full, 'rec1'))
  assert.ok(!/<[a-z]/i.test(r.text))
  assert.ok(!r.text.includes('@import'))
  assert.ok(r.text.includes('Video / Ayuda (https://youtu.be/x)'))
  assert.ok(r.text.includes('Mi novedad'))
})

test('NUL y caracteres de control se eliminan de los datos', () => {
  const v = buildVariables({ titulo: 'a' + String.fromCharCode(0) + 'b\u0007c' }, 'r')
  assert.equal(v.titulo, 'abc')
})

test('paridad con el Apps Script: mismo texto visible que la plantilla legada (si el archivo existe en data/)', (t) => {
  const file = join(process.cwd(), 'data/apps-script-email/index.html')
  if (!existsSync(file)) return t.skip('data/apps-script-email/index.html no está (carpeta ignorada por git)')
  const legacy = readFileSync(file, 'utf8')
  const d = { producto: 'Alegra POS', tipo: 'Novedad', titulo: 'Mi novedad', descripcion: 'Una descripción', documentacion: 'https://wiki.alegra.com/doc/x',
    versiones: 'v1, v2', fecha: '2026-11-15', sh: 'Contabilidad', responsables: 'a@alegra.com, b@alegra.com', video: 'https://youtu.be/x', url: 'https://bitacora.test/app?record=rec1' }
  const li = (inner: string) => `<li>${inner}</li>`
  const items = [
    li(`<strong>Descripción:</strong> ${d.descripcion}`), li(`<strong>Versión:</strong> ${d.versiones}`),
    li(`<strong>Fecha de lanzamiento:</strong> ${d.fecha}`), li(`<strong>Sh encargado:</strong> ${d.sh}`),
    li(`<strong>Responsables:</strong> ${d.responsables}`),
    li(`Puedes ver más en este <a href="${d.video}"><strong>Video / Ayuda</strong></a>.`),
    li(`Mayor información en <a href="${d.url}"><strong>WikiAlegra 🌐</strong></a>.`),
  ].join('')
  const legacyHtml = legacy
    .replace('<?= type ?>', d.tipo).replace('<?= productName ?>', d.producto).replace('<?= title ?>', d.titulo)
    .replace('<?= docURL?>', d.documentacion).replace('</ul>', items + '</ul>')
  const mine = renderEmail(tpl, { ...d, recordId: 'rec1', elaborado: 'x' } as EmailVariables).html
  assert.equal(norm(mine), norm(legacyHtml))
})
