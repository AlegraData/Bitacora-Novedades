import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString as render } from 'react-dom/server'
import { CommunicationStatus, PendingChip, pendingFor } from '@/components/email/communication-status'
import { COMMUNICATION_SINCE, MISSING_VIDEO } from '@/lib/email/communication'

const fields = [
  { id: 'ti', name: 'Tipo' },
  { id: 't', name: 'Título' }, { id: 'd', name: 'Breve descripción' }, { id: 'fl', name: 'Fecha de lanzamiento' },
  { id: 'fp', name: 'Fecha real de producción' }, { id: 'r', name: 'Responsables' }, { id: 'tv', name: '¿Trae video?' }, { id: 'v', name: 'Video' },
]
const complete = { ti: 'Novedad', t: 'T', d: 'D', fl: '2026-11-01', fp: '2026-11-02', r: ['a@alegra.com'], tv: 'No' }
const after = new Date(COMMUNICATION_SINCE.getTime() + 3_600_000).toISOString()
const before = new Date(COMMUNICATION_SINCE.getTime() - 3_600_000).toISOString()
const html = (el: Parameters<typeof render>[0]) => render(el).replace(/<!-- -->/g, '')

test('pendingFor: lista lo que falta solo para novedades posteriores al corte y aún no comunicadas', () => {
  assert.deepEqual(pendingFor(complete, fields, after, false), [])
  assert.deepEqual(pendingFor({ ...complete, d: '' }, fields, after, false), ['Breve descripción'])
  assert.deepEqual(pendingFor({ ...complete, tv: 'Sí' }, fields, after, false), [MISSING_VIDEO])
  assert.equal(pendingFor({ ...complete, d: '' }, fields, after, true), null, 'ya comunicada: sin etiqueta')
  assert.equal(pendingFor({ ...complete, d: '' }, fields, before, false), null, 'registro anterior: no se llena la tabla de pendientes')
})

test('tipos que no se comunican (Mejora, Experimento…): sin etiqueta «Pendiente» y el detalle lo explica', () => {
  for (const tipo of ['Mejora técnica', 'Experimento', 'Normativa', 'Novedades pequeñas']) {
    assert.equal(pendingFor({ ...complete, ti: tipo, d: '' }, fields, after, false), null, tipo)
    const h = html(<CommunicationStatus data={{ ...complete, ti: tipo, d: '' }} fields={fields} createdAt={after} done={false} />)
    assert.ok(h.includes('solo se envían las Novedades y las Pre-novedades'), tipo)
    assert.ok(!h.includes('Pendiente de comunicar'))
  }
  assert.deepEqual(pendingFor({ ...complete, ti: 'Pre-novedad', d: '' }, fields, after, false), ['Breve descripción'])
})

test('pendingFor: si «¿Trae video?» aún no existe como campo, la regla no bloquea', () => {
  const sin = fields.filter((f) => f.id !== 'tv')
  assert.deepEqual(pendingFor({ ...complete, tv: undefined }, sin, after, false), [])
})

test('etiqueta de la tabla: «Falta: video» y el detalle completo en el tooltip; vacía si no falta nada', () => {
  const h = html(<PendingChip missing={[MISSING_VIDEO, 'Responsables']} />)
  assert.ok(h.includes('⏳ Falta: Video') && h.includes('+1'))
  assert.ok(h.includes('Falta: Video (marcaste «¿Trae video?» = Sí), Responsables'), 'tooltip con todo')
  assert.equal(html(<PendingChip missing={[]} />), '')
  assert.equal(html(<PendingChip missing={null} />), '')
})

test('estado en el detalle: pendiente con lo que falta, lista, comunicada o registro anterior', () => {
  const pend = html(<CommunicationStatus data={{ ...complete, tv: 'Sí' }} fields={fields} createdAt={after} done={false} />)
  assert.ok(pend.includes('Pendiente de comunicar') && pend.includes('Video (marcaste'))
  assert.ok(pend.includes('el correo sale solo'))

  assert.ok(html(<CommunicationStatus data={complete} fields={fields} createdAt={after} done={false} />).includes('Lista para comunicar'))
  assert.ok(html(<CommunicationStatus data={complete} fields={fields} createdAt={after} done />).includes('Comunicada'))
  assert.ok(html(<CommunicationStatus data={{ ti: 'Novedad' }} fields={fields} createdAt={before} done={false} />).includes('Registro anterior'))
})

test('el estado reacciona a lo que se escribe: al poner el video deja de estar pendiente', () => {
  const sin = html(<CommunicationStatus data={{ ...complete, tv: 'Sí' }} fields={fields} createdAt={after} done={false} />)
  const con = html(<CommunicationStatus data={{ ...complete, tv: 'Sí', v: 'https://youtu.be/x' }} fields={fields} createdAt={after} done={false} />)
  assert.ok(sin.includes('Pendiente') && !sin.includes('Lista para comunicar'))
  assert.ok(con.includes('Lista para comunicar'))
})

test('los formularios ya no ocultan ni rellenan con N/A campos según el tipo (todos los tipos se comunican)', () => {
  for (const f of ['record-detail.tsx', 'record-editor.tsx']) {
    const src = readFileSync(join(process.cwd(), 'src/components', f), 'utf8')
    for (const gone of ['PMKT_TIPOS', 'COMM_DEPENDENT_NAMES', 'tipoNoAplica', 'naValueForType']) {
      assert.ok(!src.includes(gone), `${f} todavía usa ${gone}`)
    }
  }
})
