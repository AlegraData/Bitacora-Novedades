import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToString as render } from 'react-dom/server'
import { ENDPOINTS, ERRORS, SNIPPETS } from '@/lib/api/docs'
import { ALL_SCOPES } from '@/lib/api/constants'
import { ApiDocs } from '@/components/api-keys/api-docs'
import { GET as openapiRoute } from '@/app/api/v1/openapi.json/route'

const routeFile = (path: string) =>
  join(process.cwd(), 'src/app/api/v1', path.replace(/^\//, '').replace('{id}', '[id]'), 'route.ts')

test('cada endpoint documentado existe, con su método y scope reales (evita que la doc se desactualice)', () => {
  for (const e of ENDPOINTS) {
    const file = routeFile(e.path)
    assert.ok(existsSync(file), `falta ${file}`)
    const src = readFileSync(file, 'utf8')
    const scope = e.scope ? `'${e.scope}'` : 'null'
    assert.match(src, new RegExp(`export const ${e.method} = apiRoute\\(${scope}`), `${e.method} ${e.path} → scope ${scope}`)
  }
})

test('todo método exportado por las rutas de /api/v1 está documentado', () => {
  const documented = new Set(ENDPOINTS.map((e) => `${e.method} ${e.path}`))
  const files: [string, string][] = [
    ['/me', 'me'], ['/fields', 'fields'], ['/records', 'records'], ['/records/search', 'records/search'],
    ['/records/{id}', 'records/[id]'], ['/records/{id}/notify-pmkt', 'records/[id]/notify-pmkt'], ['/audit-log', 'audit-log'],
  ]
  for (const [apiPath, dir] of files) {
    const src = readFileSync(join(process.cwd(), 'src/app/api/v1', dir, 'route.ts'), 'utf8')
    for (const m of src.matchAll(/export const (GET|POST|PATCH|DELETE|PUT) = /g)) {
      assert.ok(documented.has(`${m[1]} ${apiPath}`), `${m[1]} ${apiPath} no está en la documentación`)
    }
  }
})

test('los scopes usados en la doc existen', () => {
  for (const e of ENDPOINTS) if (e.scope) assert.ok(ALL_SCOPES.includes(e.scope))
})

test('OpenAPI: estructura válida, seguridad Bearer y todas las rutas', async () => {
  const res = openapiRoute()
  assert.equal(res.status, 200)
  const spec = await res.json()
  assert.equal(spec.openapi, '3.0.3')
  assert.ok(spec.components.securitySchemes.bearerAuth)
  assert.equal(Object.keys(spec.paths).length, new Set(ENDPOINTS.map((e) => e.path)).size)
  assert.ok(spec.paths['/records/{id}'].patch.requestBody)
  assert.equal(spec.paths['/records/{id}'].delete['x-required-scope'], 'records:delete')
  const ids = Object.values(spec.paths).flatMap((p) => Object.values(p as Record<string, { operationId: string }>).map((o) => o.operationId))
  assert.equal(new Set(ids).size, ids.length, 'operationId únicos')
  // el spec es público: no debe contener nada parecido a un token
  assert.ok(!JSON.stringify(spec).match(/btk_[A-Za-z0-9_-]{43}/))
})

test('los ejemplos de la doc no incluyen tokens reales', () => {
  const all = JSON.stringify([ENDPOINTS, SNIPPETS, ERRORS])
  assert.ok(!all.match(/btk_[A-Za-z0-9_-]{43}/))
})

test('la página de docs renderiza secciones clave', () => {
  const html = render(createElement(ApiDocs)).replace(/<!-- -->/g, '')
  for (const t of ['URL base y autenticación', 'Permisos (scopes)', 'Endpoints', 'Errores', '/records/search', 'records:delete', 'Authorization: Bearer', '3 tokens activos']) {
    assert.ok(html.includes(t), `falta "${t}"`)
  }
})
