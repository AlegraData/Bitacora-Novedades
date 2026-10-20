import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString as render } from 'react-dom/server'
import { ApiKeysManager } from '@/components/api-keys/api-keys-manager'
import type { ApiKeyDTO } from '@/lib/api/keys'

// React SSR separa nodos de texto con <!-- -->; se quitan para poder afirmar sobre el texto visible.
const renderToString = (el: Parameters<typeof render>[0]) => render(el).replace(/<!-- -->/g, '')

const key = (over: Partial<ApiKeyDTO>): ApiKeyDTO => ({
  id: 'k1', name: 'Reverse sync', description: 'Apps Script', prefix: 'btk_AbCdEf', scopes: ['records:read'],
  ownerEmail: 'ana@alegra.com', ownerName: 'Ana', status: 'active', expiresAt: '2027-01-01T00:00:00.000Z',
  lastUsedAt: null, lastUsedIp: null, lastUsedUserAgent: null, useCount: 0, revokedAt: null, createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
})

test('admin: muestra dueño, prefijo, scopes y contador de cupo; nunca un token completo', () => {
  const html = renderToString(
    <ApiKeysManager
      mode="admin"
      isAdmin
      currentUserEmail="ana@alegra.com"
      initialKeys={[key({}), key({ id: 'k2', name: 'Viejo', status: 'revoked', scopes: ['records:delete'] })]}
    />
  )
  assert.match(html, /Reverse sync/)
  assert.match(html, /ana@alegra.com/)
  assert.match(html, /btk_AbCdEf…/)
  assert.match(html, /1\/3/)
  assert.doesNotMatch(html, /Viejo/, 'por defecto solo se listan los activos')
  assert.match(html, /Nuevo token/)
})

test('con 3 activos propios el botón de crear queda deshabilitado', () => {
  const keys = [1, 2, 3].map((i) => key({ id: `k${i}`, name: `t${i}` }))
  const html = renderToString(<ApiKeysManager mode="user" isAdmin={false} currentUserEmail="ana@alegra.com" initialKeys={keys} />)
  assert.match(html, /3\/3/)
  assert.match(html, /<button[^>]*disabled[^>]*>＋ Nuevo token/)
})

test('los tokens de otros no cuentan contra mi cupo', () => {
  const keys = [1, 2, 3].map((i) => key({ id: `k${i}`, ownerEmail: 'otro@alegra.com' }))
  const html = renderToString(<ApiKeysManager mode="admin" isAdmin currentUserEmail="ana@alegra.com" initialKeys={keys} />)
  assert.match(html, /0\/3/)
})
