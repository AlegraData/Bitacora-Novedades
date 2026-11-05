// El Google Frontend de Cloud Run descarta los encabezados con caracteres no ASCII. Con realm="Bitácora …" los 401 de
// producción salían SIN WWW-Authenticate y los clientes OAuth/MCP no podían descubrir cómo autenticarse.
// Estas pruebas fijan que el encabezado siga siendo ASCII puro y empiece por "Bearer".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST as mcpPost } from '@/app/api/mcp/route'
import { apiRoute, apiJson } from '@/lib/api/http'

const ASCII = /^[\x20-\x7e]+$/

test('el 401 del MCP lleva WWW-Authenticate en ASCII puro con esquema Bearer', async () => {
  const res = await mcpPost(
    new NextRequest('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
  )
  assert.equal(res.status, 401)
  const h = res.headers.get('www-authenticate')!
  assert.match(h, /^Bearer /)
  assert.match(h, ASCII)
})

test('el 401 de la API REST lleva WWW-Authenticate en ASCII puro con esquema Bearer', async () => {
  const route = apiRoute('records:read', async () => apiJson({ ok: true }))
  const res = await route(new NextRequest('http://localhost/api/v1/x'), { params: Promise.resolve({}) })
  assert.equal(res.status, 401)
  const h = res.headers.get('www-authenticate')!
  assert.match(h, /^Bearer /)
  assert.match(h, ASCII)
})
