import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateCommunication, traeVideoAnswer, logicalFromFields, hasTraeVideoField, isMissing,
  MISSING_TRAE_VIDEO, MISSING_VIDEO, COMMUNICATION_SINCE, isCommunicableTipo, TIPO_NO_COMUNICABLE,
} from '@/lib/email/communication'
import { sendNovedad } from '@/lib/email/service'
import { prisma } from '@/lib/prisma'
import { resetDb, ensureFields } from './helpers'
import { clearMailbox, getMessage, listMessages } from './mailpit'
import { viewer, makeRecord, setMode } from './email-helpers'

const complete = {
  titulo: 'T', breveDescripcion: 'D', fechaLanzamiento: '2026-11-01', fechaProduccion: '2026-11-05', responsables: ['a@alegra.com'], traeVideo: 'No',
}

test('evaluateCommunication: completo → listo; cada campo obligatorio que falte se nombra', () => {
  assert.deepEqual(evaluateCommunication(complete, { traeVideoConfigured: true }), { ready: true, missing: [] })
  const labels: Record<string, string> = {
    titulo: 'Título', breveDescripcion: 'Breve descripción', fechaLanzamiento: 'Fecha de lanzamiento',
    fechaProduccion: 'Fecha real de producción', responsables: 'Responsables', traeVideo: MISSING_TRAE_VIDEO,
  }
  for (const [key, label] of Object.entries(labels)) {
    const r = evaluateCommunication({ ...complete, [key]: undefined }, { traeVideoConfigured: true })
    assert.deepEqual([r.ready, r.missing], [false, [label]], key)
  }
  const all = evaluateCommunication({}, { traeVideoConfigured: true })
  assert.equal(all.missing.length, 6)
})

test('«Correos a comunicar» ya no es obligatorio (queda como dato informativo)', () => {
  const r = evaluateCommunication({ ...complete, correosAComunicar: [] }, { traeVideoConfigured: true })
  assert.equal(r.ready, true)
})

test('¿Trae video?: No → listo sin video; Sí → exige Video; sin elegir → pendiente', () => {
  assert.equal(evaluateCommunication({ ...complete, traeVideo: 'No' }, { traeVideoConfigured: true }).ready, true)
  assert.equal(evaluateCommunication({ ...complete, traeVideo: 'No', video: 'https://v.com/x' }, { traeVideoConfigured: true }).ready, true)

  const sinVideo = evaluateCommunication({ ...complete, traeVideo: 'Sí' }, { traeVideoConfigured: true })
  assert.deepEqual([sinVideo.ready, sinVideo.missing], [false, [MISSING_VIDEO]])
  assert.equal(evaluateCommunication({ ...complete, traeVideo: 'Sí', video: '   ' }, { traeVideoConfigured: true }).ready, false)
  assert.equal(evaluateCommunication({ ...complete, traeVideo: 'Sí', video: 'https://v.com/x' }, { traeVideoConfigured: true }).ready, true)

  assert.deepEqual(evaluateCommunication({ ...complete, traeVideo: '' }, { traeVideoConfigured: true }).missing, [MISSING_TRAE_VIDEO])
  assert.deepEqual(evaluateCommunication({ ...complete, traeVideo: 'Quizás' }, { traeVideoConfigured: true }).missing, [MISSING_TRAE_VIDEO])
})

test('Sí/No se reconoce con mayúsculas, sin tilde, booleanos y arreglos', () => {
  for (const v of ['Sí', 'SI', 'si', ' Sí ', 'yes', true, ['Sí']]) assert.equal(traeVideoAnswer(v), 'yes', String(v))
  for (const v of ['No', 'NO', 'no', false, ['No']]) assert.equal(traeVideoAnswer(v), 'no', String(v))
  for (const v of [undefined, null, '', 'tal vez', 5, {}, []]) assert.equal(traeVideoAnswer(v), null, String(v))
})

test('si el campo «¿Trae video?» aún no existe la regla se omite (desplegar antes de crearlo no bloquea nada)', () => {
  assert.equal(evaluateCommunication({ ...complete, traeVideo: undefined }, { traeVideoConfigured: false }).ready, true)
  assert.equal(evaluateCommunication({ ...complete, traeVideo: undefined, video: undefined }, { traeVideoConfigured: false }).ready, true)
})

test('isMissing: vacíos, espacios, arreglos vacíos o de vacíos; false/0 cuentan como dato', () => {
  for (const v of [undefined, null, '', '   ', [], [''], [' ', null]]) assert.equal(isMissing(v), true, JSON.stringify(v))
  for (const v of ['x', 0, false, ['a']]) assert.equal(isMissing(v), false, JSON.stringify(v))
})

test('logicalFromFields arma el objeto lógico por nombre de campo (para la pantalla)', () => {
  const fields = [{ id: 'f1', name: 'Título' }, { id: 'f2', name: '¿Trae video?' }, { id: 'f3', name: 'Video' }, { id: 'f4', name: 'Otro' }]
  const logical = logicalFromFields({ f1: 'Mi título', f2: 'Sí', f3: 'https://v.com', f4: 'x' }, fields)
  assert.deepEqual(logical, { titulo: 'Mi título', traeVideo: 'Sí', video: 'https://v.com' })
  assert.equal(hasTraeVideoField(fields), true)
  assert.equal(hasTraeVideoField([{ name: 'Título' }]), false)
})

// ---------- criterios de aceptación de TMDIAPD-56 sobre el servicio real ----------

// Decisión final de PMKT: solo Novedad y Pre-novedad (con sus variantes de escritura) se comunican.
const TIPOS = ['Novedad', 'Pre-novedad', 'Pre novedad']
const TIPOS_NO_COMUNICABLES = ['Mejora técnica', 'Experimento', 'Normativa', 'Novedades pequeñas', 'Resolución de Issues', 'Mejora']

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  await clearMailbox()
  await setMode('live')
})

const send = (id: string, trigger: 'auto' | 'manual' = 'auto') => sendNovedad({ recordId: id, actor: viewer, channel: 'web', trigger })

test('isCommunicableTipo: Novedad y Pre-novedad (sin importar tildes, mayúsculas ni guion); el resto no', () => {
  for (const t of ['Novedad', 'novedad', ' NOVEDAD ', 'Pre-novedad', 'Pre novedad', 'pre-Novedad', ['Novedad']]) assert.equal(isCommunicableTipo(t), true, String(t))
  for (const t of [...TIPOS_NO_COMUNICABLES, 'Novedades', 'Pre-novedades', '', '   ', undefined, null, 5, {}, []]) assert.equal(isCommunicableTipo(t), false, String(t))
})

test('se envía un correo para Novedad y Pre-novedad cuando sus campos obligatorios están completos', async () => {
  for (const tipo of TIPOS) {
    const r = await makeRecord({ tipo, titulo: `Novedad ${tipo}` })
    const res = await send(r.id)
    assert.equal(res.status, 'sent', tipo)
  }
  const subjects = await Promise.all((await listMessages()).map(async (m) => (await getMessage(m.ID)).Subject))
  assert.equal(subjects.length, TIPOS.length)
  for (const tipo of TIPOS) assert.ok(subjects.some((s) => s.startsWith(`${tipo} |`)), `falta el correo del tipo ${tipo}`)
})

test('los demás tipos NO se envían: ni automático ni con el botón; no se toma lock ni sale correo', async () => {
  for (const tipo of TIPOS_NO_COMUNICABLES) {
    const r = await makeRecord({ tipo })
    const auto = await send(r.id)
    assert.deepEqual([auto.status, auto.skippedReason], ['skipped', 'tipo_no_comunicable'], tipo)
    const manual = await send(r.id, 'manual')
    assert.equal(manual.status, 'failed', tipo)
    assert.equal(manual.error?.code, 'VALIDATION')
    assert.equal(manual.error?.message, TIPO_NO_COMUNICABLE)
    // tampoco con el reenvío ni en simulacro
    assert.equal((await sendNovedad({ recordId: r.id, actor: viewer, channel: 'web', trigger: 'manual', simulate: true })).status, 'failed')
    assert.equal(await prisma.emailDelivery.count({ where: { recordId: r.id } }), 0, 'no deja ni rastro de envío')
  }
  assert.equal((await listMessages()).length, 0)
  // un registro sin tipo tampoco se comunica
  const sinTipo = await makeRecord({ tipo: undefined })
  assert.equal((await send(sinTipo.id)).skippedReason, 'tipo_no_comunicable')
})

test('un registro incompleto no se envía: queda pendiente y dice qué falta (para cada tipo)', async () => {
  for (const tipo of TIPOS) {
    const r = await makeRecord({ tipo, breveDescripcion: undefined, fechaProduccion: undefined })
    const auto = await send(r.id)
    assert.equal(auto.status, 'skipped', tipo)
    assert.equal(auto.skippedReason, 'campos_incompletos')
    assert.deepEqual(auto.missingFields?.sort(), ['Breve descripción', 'Fecha real de producción'])
    assert.equal((await send(r.id, 'manual')).error?.code, 'VALIDATION')
  }
  assert.equal((await listMessages()).length, 0)
})

test('¿Trae video? = No y el resto completo → se envía SIN video', async () => {
  const r = await makeRecord({ traeVideo: 'No' })
  assert.equal((await send(r.id)).status, 'sent')
  const mail = await getMessage((await listMessages())[0].ID)
  assert.ok(!mail.HTML.includes('Video / Ayuda'))
  assert.ok(!/undefined|null/.test(mail.HTML))
})

test('¿Trae video? = Sí y Video vacío → NO se envía, queda «Falta video»; al agregar el video, se envía', async () => {
  const r = await makeRecord({ traeVideo: 'Sí' })
  const pend = await send(r.id)
  assert.equal(pend.status, 'skipped')
  assert.deepEqual(pend.missingFields, [MISSING_VIDEO])
  assert.equal((await listMessages()).length, 0)

  // se agrega el video (el guardado dispara el envío automático)
  const { loadFieldMap } = await import('@/lib/mcp/fields')
  const map = await loadFieldMap()
  const rec = await prisma.record.findUniqueOrThrow({ where: { id: r.id } })
  await prisma.record.update({ where: { id: r.id }, data: { data: { ...(rec.data as object), [map.get('video')!.id]: 'https://youtu.be/abc' } } })
  assert.equal((await send(r.id)).status, 'sent')
  const mail = await getMessage((await listMessages())[0].ID)
  assert.ok(mail.HTML.includes('Video / Ayuda') && mail.HTML.includes('https://youtu.be/abc'.replace('=', '&#x3D;')))
})

test('sin responder «¿Trae video?» el registro queda pendiente', async () => {
  const r = await makeRecord({ traeVideo: undefined })
  const res = await send(r.id)
  assert.deepEqual([res.status, res.missingFields], ['skipped', [MISSING_TRAE_VIDEO]])
})

test('el envío automático no toca registros anteriores al despliegue (sin retroactividad), pero el manual sí puede', async () => {
  const old = await makeRecord({ tipo: 'Novedad' }, new Date(COMMUNICATION_SINCE.getTime() - 86_400_000))
  assert.equal((await send(old.id)).skippedReason, 'registro_anterior_al_cutover')
  assert.equal((await listMessages()).length, 0)
  assert.equal((await send(old.id, 'manual')).status, 'sent')
})
