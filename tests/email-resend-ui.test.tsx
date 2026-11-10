import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString as render } from 'react-dom/server'
import { DeliveryDetail } from '@/components/email/deliveries-panel'
import type { DeliveryDTO } from '@/lib/email/history'

const base: DeliveryDTO = {
  id: 'd1', recordId: 'r1', mode: 'live', status: 'sent', subject: 'Novedad | X', recipients: ['tm-alegra@alegra.com'], rejected: [],
  channel: 'web', trigger: 'auto', triggeredByEmail: 'a@alegra.com', triggeredByName: 'A', resendReason: null, errorCode: null, errorMessage: null,
  chatStatus: null, createdAt: '2026-11-01T10:00:00.000Z', finishedAt: null, durationMs: null,
}
const html = (d: DeliveryDTO, onResent?: () => void) => render(<DeliveryDetail d={d} onClose={() => {}} onResent={onResent} />).replace(/<!-- -->/g, '')

test('el detalle ofrece reejecutar con motivo para envíos reales (enviados o fallidos)', () => {
  for (const status of ['sent', 'failed']) {
    const h = html({ ...base, status }, () => {})
    assert.ok(h.includes('Volver a ejecutar este envío'), status)
    assert.ok(h.includes('Motivo del reenvío'))
    assert.ok(/disabled=""[^>]*>Reenviar con este motivo/.test(h) || h.includes('Reenviar con este motivo'))
  }
})

test('no se ofrece para simulacros, pruebas, envíos sin novedad ni sin el callback', () => {
  assert.ok(!html({ ...base, status: 'simulated', mode: 'simulate' }, () => {}).includes('Volver a ejecutar'))
  assert.ok(!html({ ...base, mode: 'test' }, () => {}).includes('Volver a ejecutar'))
  assert.ok(!html({ ...base, recordId: null }, () => {}).includes('Volver a ejecutar'))
  assert.ok(!html(base).includes('Volver a ejecutar'))
})
