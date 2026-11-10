import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_RULES, DEFAULT_REQUIRED_FIELDS, REQUIRABLE_FIELDS, findRule, isCommunicableTipo, shouldAutoSend,
  evaluateCommunication, isRequirableField, MISSING_TRAE_VIDEO, MISSING_VIDEO, COMMUNICATION_SINCE, type CommunicationRule,
} from '@/lib/email/communication'

const after = new Date(COMMUNICATION_SINCE.getTime() + 86_400_000)
const before = new Date(COMMUNICATION_SINCE.getTime() - 86_400_000)
const rule = (over: Partial<CommunicationRule> = {}): CommunicationRule => ({ tipo: 'Experimento', mode: 'AUTO', requiredFields: ['titulo'], autoSince: null, ...over })

test('reglas de fábrica: Novedad y Pre-novedad en AUTO con el criterio de hoy; el resto no tiene regla', () => {
  assert.deepEqual(DEFAULT_RULES.map((r) => [r.tipo, r.mode]), [['Novedad', 'AUTO'], ['Pre-novedad', 'AUTO']])
  assert.deepEqual(DEFAULT_REQUIRED_FIELDS, ['titulo', 'breveDescripcion', 'fechaLanzamiento', 'fechaProduccion', 'responsables', 'traeVideo'])
  assert.equal(isCommunicableTipo('Experimento'), false)
  assert.equal(isCommunicableTipo('pre novedad'), true)
  assert.equal(isCommunicableTipo(['Novedad']), true)
})

test('findRule ignora tildes, mayúsculas y guiones; un tipo vacío o sin regla no tiene regla', () => {
  assert.equal(findRule(DEFAULT_RULES, 'PRE NOVEDAD')?.tipo, 'Pre-novedad')
  assert.equal(findRule(DEFAULT_RULES, ''), null)
  assert.equal(findRule(DEFAULT_RULES, undefined), null)
  assert.equal(findRule(DEFAULT_RULES, 'Mejora técnica'), null)
})

test('DISABLED no se comunica; MANUAL y AUTO sí', () => {
  for (const [mode, ok] of [['AUTO', true], ['MANUAL', true], ['DISABLED', false]] as const) {
    assert.equal(isCommunicableTipo('Experimento', [rule({ mode })]), ok, mode)
  }
})

test('shouldAutoSend: solo en AUTO, sin retroactivos (corte global y corte propio)', () => {
  assert.equal(shouldAutoSend(rule({ mode: 'AUTO' }), after), true)
  assert.equal(shouldAutoSend(rule({ mode: 'MANUAL' }), after), false)
  assert.equal(shouldAutoSend(rule({ mode: 'DISABLED' }), after), false)
  assert.equal(shouldAutoSend(null, after), false)
  assert.equal(shouldAutoSend(rule(), before), false, 'anterior al corte global')
  const cut = new Date(after.getTime() + 86_400_000)
  assert.equal(shouldAutoSend(rule({ autoSince: cut.toISOString() }), after), false, 'anterior al corte de la regla')
  assert.equal(shouldAutoSend(rule({ autoSince: cut.toISOString() }), new Date(cut.getTime() + 1000)), true)
})

test('evaluateCommunication usa el criterio de la regla (por campo y por tipo)', () => {
  const r = evaluateCommunication({ titulo: 'T' }, { traeVideoConfigured: true, requiredFields: ['titulo'] })
  assert.deepEqual(r, { ready: true, missing: [] })
  const r2 = evaluateCommunication({ titulo: 'T' }, { traeVideoConfigured: true, requiredFields: ['titulo', 'producto', 'usuarioImpactado'] })
  assert.deepEqual(r2.missing, ['Producto', 'Usuario impactado'])
  // Sin «traeVideo» en el criterio, ni siquiera se pregunta por video.
  assert.equal(evaluateCommunication({ titulo: 'T' }, { traeVideoConfigured: true, requiredFields: ['titulo'] }).ready, true)
})

test('«traeVideo» es un criterio compuesto; si «video» es obligatorio por sí solo no se duplica el aviso', () => {
  const only = { traeVideoConfigured: true, requiredFields: ['titulo', 'traeVideo'] }
  assert.deepEqual(evaluateCommunication({ titulo: 'T' }, only).missing, [MISSING_TRAE_VIDEO])
  assert.deepEqual(evaluateCommunication({ titulo: 'T', traeVideo: 'Sí' }, only).missing, [MISSING_VIDEO])
  const both = { traeVideoConfigured: true, requiredFields: ['titulo', 'traeVideo', 'video'] }
  assert.deepEqual(evaluateCommunication({ titulo: 'T', traeVideo: 'Sí' }, both).missing, ['Video'])
  assert.deepEqual(evaluateCommunication({ titulo: 'T' }, { traeVideoConfigured: false, requiredFields: ['titulo', 'traeVideo'] }).missing, [])
})

test('campos exigibles: nada de tipo, URL ni status', () => {
  const keys = REQUIRABLE_FIELDS.map((f) => f.key)
  assert.ok(keys.includes('titulo') && keys.includes('traeVideo'))
  for (const k of ['tipo', 'urlBitacora', 'status']) assert.ok(!keys.includes(k), k)
  assert.equal(isRequirableField('titulo'), true)
  assert.equal(isRequirableField('inventado'), false)
  assert.equal(isRequirableField(5), false)
})
