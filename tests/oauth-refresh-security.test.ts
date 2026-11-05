// OAuth del MCP: renovación de tokens (rotación atómica, gracia, freno a bucles) y metadatos de recurso protegido.
// Se usa un "db" falso CON ESTADO y con bloqueo de transacciones (modela el bloqueo de fila de Postgres) para probar la
// semántica real —qué sesión queda viva y quién gana una carrera— y no solo que se llamó a un mock. No necesita base de datos.
import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST as tokenPost } from '@/app/oauth/token/route'
import { GET as prmGet } from '@/app/.well-known/oauth-protected-resource/route'
import { GET as prmMcpGet } from '@/app/.well-known/oauth-protected-resource/api/mcp/route'
import { POST as mcpPost } from '@/app/api/mcp/route'
import { wwwAuthenticate, protectedResourceMetadata, publicOrigin } from '@/lib/oauth/metadata'
import {
  refreshSession,
  setOAuthDbForTests,
  resetLimiterForTests,
  REFRESH_GRACE_MS,
  LIMIT_MAX_FAILURES,
  ACCESS_TTL_MS,
  type OAuthDb,
} from '@/lib/oauth/refresh'

type Row = {
  id: string
  accessToken: string
  refreshToken: string
  userEmail: string
  clientId: string
  clientName: string | null
  expiresAt: Date
  refreshExpiresAt: Date
  revokedAt: Date | null
  createdAt: Date
}

let rows: Row[] = []
let seq = 0

const matches = (r: Row, w: Record<string, unknown>) =>
  Object.entries(w).every(([k, v]) => {
    const cur = (r as unknown as Record<string, unknown>)[k]
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const gt = (v as { gt?: Date }).gt
      return gt ? (cur as Date) > gt : false
    }
    if (v instanceof Date) return cur instanceof Date && cur.getTime() === v.getTime()
    return cur === v
  })

const calls = { findUnique: 0, create: 0 }
const oAuthSession: OAuthDb['oAuthSession'] = {
  findUnique: async ({ where }) => {
    calls.findUnique++
    return (rows.find((r) => matches(r, where)) as never) ?? null
  },
  findFirst: async ({ where }) => (rows.find((r) => matches(r, where)) as never) ?? null,
  updateMany: async ({ where, data }) => {
    const hit = rows.filter((r) => matches(r, where))
    hit.forEach((r) => Object.assign(r, data))
    return { count: hit.length }
  },
  create: async ({ data }) => {
    calls.create++
    const row = { id: `s${++seq}`, clientName: null, revokedAt: null, createdAt: new Date(), ...data } as Row
    rows.push(row)
    return row
  },
}
let lock: Promise<unknown> = Promise.resolve()
const fakeDb: OAuthDb = {
  oAuthSession,
  $transaction: (fn) => {
    const run = lock.then(() => fn(fakeDb))
    lock = run.catch(() => {})
    return run as never
  },
}

const T0 = new Date('2026-11-05T12:00:00.000Z')
const seed = (o: Partial<Row> = {}): Row => {
  const r: Row = {
    id: `s${++seq}`,
    accessToken: `at-${seq}`,
    refreshToken: `rt-${seq}`,
    userEmail: 'ana@alegra.com',
    clientId: 'client-A',
    clientName: 'Hermes',
    expiresAt: new Date(T0.getTime() + 60_000),
    refreshExpiresAt: new Date(T0.getTime() + 86_400_000),
    revokedAt: null,
    createdAt: new Date(T0.getTime() - 3_600_000),
    ...o,
  }
  rows.push(r)
  return r
}

const refreshReq = (rt: string, clientId: string | null = 'client-A', ip = '1.1.1.1', ua = 'Hermes-Agent/0.22.5') => {
  const p = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt })
  if (clientId !== null) p.set('client_id', clientId)
  return new NextRequest('https://x.test/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip, 'user-agent': ua },
    body: p.toString(),
  })
}

let warnLines: string[] = []
beforeEach(() => {
  rows = []
  calls.findUnique = 0
  calls.create = 0
  lock = Promise.resolve()
  setOAuthDbForTests(fakeDb)
  resetLimiterForTests()
  warnLines = []
  mock.method(console, 'warn', (...a: unknown[]) => void warnLines.push(String(a[0])))
  process.env.APP_PUBLIC_URL = 'https://bitacora.example.com'
})
afterEach(() => {
  mock.restoreAll()
  mock.timers.reset()
  setOAuthDbForTests(null)
})

test('rotación normal: tokens nuevos, el anterior revocado y UNA sola sesión viva', async () => {
  const s = seed()
  const r = await refreshSession(s.refreshToken, 'client-A', T0)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.graceReplay, false)
  assert.notEqual(r.refreshToken, s.refreshToken)
  assert.equal(rows.filter((x) => !x.revokedAt).length, 1)
  assert.deepEqual(rows.find((x) => x.id === s.id)!.revokedAt, T0)
  const created = rows.find((x) => x.accessToken === r.accessToken)!
  assert.equal(created.userEmail, 'ana@alegra.com')
  assert.equal(created.expiresAt.getTime() - T0.getTime(), ACCESS_TTL_MS)
})

test('los tokens son aleatorios, de 43 caracteres base64url y distintos entre sí', async () => {
  const a = await refreshSession(seed().refreshToken, 'client-A', T0)
  const b = await refreshSession(seed().refreshToken, 'client-A', T0)
  if (!a.ok || !b.ok) throw new Error('debían renovar')
  const all = [a.accessToken, a.refreshToken, b.accessToken, b.refreshToken]
  for (const t of all) assert.match(t, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(new Set(all).size, 4)
})

test('gracia: reintento del token viejo dentro de 30 s devuelve los tokens del sucesor sin crear otra sesión', async () => {
  const s = seed()
  const first = await refreshSession(s.refreshToken, 'client-A', T0)
  const total = rows.length
  const again = await refreshSession(s.refreshToken, 'client-A', new Date(T0.getTime() + 5_000))
  if (!first.ok || !again.ok) throw new Error('ambos debían funcionar')
  assert.equal(again.graceReplay, true)
  assert.equal(again.refreshToken, first.refreshToken)
  assert.equal(again.accessToken, first.accessToken)
  assert.equal(rows.length, total)
})

test('pasada la ventana el token viejo queda rechazado (no es una puerta trasera permanente)', async () => {
  const s = seed()
  await refreshSession(s.refreshToken, 'client-A', T0)
  const late = await refreshSession(s.refreshToken, 'client-A', new Date(T0.getTime() + REFRESH_GRACE_MS + 1))
  assert.deepEqual(late, { ok: false, reason: 'revoked' })
})

test('dos refresh simultáneos con el mismo token: ambos reciben la MISMA sesión y no se duplica', async () => {
  const s = seed()
  const [a, b] = await Promise.all([refreshSession(s.refreshToken, 'client-A', T0), refreshSession(s.refreshToken, 'client-A', T0)])
  if (!a.ok || !b.ok) throw new Error('ambos debían funcionar')
  assert.equal(a.refreshToken, b.refreshToken)
  assert.equal(rows.filter((x) => !x.revokedAt).length, 1)
  assert.deepEqual([a.graceReplay, b.graceReplay].sort(), [false, true])
})

test('una sesión revocada A MANO dentro de la ventana no se resucita', async () => {
  const s = seed({ revokedAt: new Date(T0.getTime() - 1_000) })
  assert.deepEqual(await refreshSession(s.refreshToken, 'client-A', T0), { ok: false, reason: 'revoked' })
})

test('si el usuario re-autoriza (sesión nueva con otro instante), el token viejo NO recibe la sesión nueva', async () => {
  const s = seed({ revokedAt: new Date(T0.getTime() - 2_000) })
  const fresh = seed({ createdAt: new Date(T0.getTime() - 1_900) })
  assert.deepEqual(await refreshSession(s.refreshToken, 'client-A', T0), { ok: false, reason: 'revoked' })
  assert.equal(fresh.revokedAt, null)
})

test('una revocación manual de la sucesora corta la cadena', async () => {
  const s = seed()
  const first = await refreshSession(s.refreshToken, 'client-A', T0)
  if (!first.ok) throw new Error('debía renovar')
  rows.find((x) => x.refreshToken === first.refreshToken)!.revokedAt = new Date(T0.getTime() + 1_000)
  assert.deepEqual(await refreshSession(s.refreshToken, 'client-A', new Date(T0.getTime() + 2_000)), { ok: false, reason: 'revoked' })
})

test('el sucesor es del MISMO usuario: no se mezclan sesiones de otra persona creadas en el mismo instante', async () => {
  const s = seed()
  seed({ userEmail: 'otro@alegra.com', createdAt: T0, refreshToken: 'rt-ajeno', accessToken: 'at-ajeno' })
  s.revokedAt = T0
  assert.deepEqual(await refreshSession(s.refreshToken, 'client-A', new Date(T0.getTime() + 1_000)), { ok: false, reason: 'revoked' })
})

test('token inexistente', async () => {
  assert.deepEqual(await refreshSession('nope', 'client-A', T0), { ok: false, reason: 'unknown_token' })
})

test('token de OTRO cliente: rechazado y la sesión no se toca', async () => {
  const s = seed()
  assert.deepEqual(await refreshSession(s.refreshToken, 'client-B', T0), { ok: false, reason: 'client_mismatch' })
  assert.equal(rows.find((x) => x.id === s.id)!.revokedAt, null)
  assert.equal(calls.create, 0)
})

test('sin client_id (clientes que no lo envían) se mantiene el comportamiento anterior: se acepta', async () => {
  const s = seed()
  assert.equal((await refreshSession(s.refreshToken, null, T0)).ok, true)
})

test('refresh token vencido, también cuando ya estaba rotado', async () => {
  const s = seed({ refreshExpiresAt: new Date(T0.getTime() - 1) })
  assert.deepEqual(await refreshSession(s.refreshToken, 'client-A', T0), { ok: false, reason: 'expired' })
  const r = seed({ refreshExpiresAt: new Date(T0.getTime() - 1), revokedAt: new Date(T0.getTime() - 1_000) })
  assert.deepEqual(await refreshSession(r.refreshToken, 'client-A', T0), { ok: false, reason: 'expired' })
  assert.equal(calls.create, 0)
})

// ── Endpoint /oauth/token ──────────────────────────────────────────────────────────────────────────────────────────
test('endpoint: éxito con no-store, CORS y cuerpo estándar', async () => {
  const s = seed({ refreshExpiresAt: new Date(Date.now() + 86_400_000) })
  const res = await tokenPost(refreshReq(s.refreshToken))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(res.headers.get('pragma'), 'no-cache')
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  const body = await res.json()
  assert.equal(body.token_type, 'Bearer')
  assert.equal(body.expires_in, 900)
  assert.ok(body.access_token && body.refresh_token)
})

test('endpoint: no filtra el motivo — inexistente, de otro cliente y revocado responden IGUAL', async () => {
  const s = seed({ refreshExpiresAt: new Date(Date.now() + 86_400_000) })
  const revoked = seed({ refreshExpiresAt: new Date(Date.now() + 86_400_000), revokedAt: new Date(Date.now() - 3_600_000) })
  const out = []
  for (const r of [refreshReq('inexistente'), refreshReq(s.refreshToken, 'client-X', '2.2.2.2'), refreshReq(revoked.refreshToken, 'client-A', '3.3.3.3')]) {
    const res = await tokenPost(r)
    out.push({ status: res.status, body: await res.json() })
  }
  for (const o of out) assert.deepEqual(o, { status: 400, body: { error: 'invalid_grant' } })
})

test('endpoint: token vencido da un mensaje claro para re-autenticar', async () => {
  const s = seed({ refreshExpiresAt: new Date(Date.now() - 1000) })
  const res = await tokenPost(refreshReq(s.refreshToken))
  assert.equal(res.status, 400)
  assert.match((await res.json()).error_description, /re-authenticate/)
})

test('endpoint: el log trae el motivo, es JSON de una línea y NO contiene tokens', async () => {
  const s = seed()
  await tokenPost(refreshReq('secreto-que-no-debe-salir', 'client-A\r\nFAKE: linea', '1.1.1.1', 'Hermes ñ'))
  await tokenPost(refreshReq(s.refreshToken, 'client-X', '1.1.1.2'))
  assert.equal(warnLines.length, 2)
  for (const l of warnLines) {
    assert.ok(!/secreto-que-no-debe-salir|rt-\d/.test(l))
    assert.ok(!/[\r\n]/.test(l))
    assert.equal(JSON.parse(l).event, 'oauth_refresh_rejected')
  }
  assert.equal(JSON.parse(warnLines[0]).reason, 'unknown_token')
  assert.equal(JSON.parse(warnLines[0]).userAgent, 'Hermes ?')
  assert.equal(JSON.parse(warnLines[1]).reason, 'client_mismatch')
})

test(`endpoint: tras ${LIMIT_MAX_FAILURES} fallos seguidos responde 429 con Retry-After y NO toca la base`, async () => {
  for (let i = 0; i < LIMIT_MAX_FAILURES; i++) assert.equal((await tokenPost(refreshReq('malo'))).status, 400)
  calls.findUnique = 0
  const res = await tokenPost(refreshReq('malo'))
  assert.equal(res.status, 429)
  const wait = Number(res.headers.get('retry-after'))
  assert.ok(wait >= 1 && wait <= 60)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(calls.findUnique, 0)
})

test('endpoint: el freno es por IP+cliente; otro cliente u otra IP siguen funcionando', async () => {
  const s = seed({ refreshExpiresAt: new Date(Date.now() + 86_400_000) })
  for (let i = 0; i < LIMIT_MAX_FAILURES + 2; i++) await tokenPost(refreshReq('malo', 'client-A', '9.9.9.9'))
  assert.equal((await tokenPost(refreshReq('malo', 'client-A', '9.9.9.9'))).status, 429)
  assert.equal((await tokenPost(refreshReq(s.refreshToken, 'client-A', '8.8.8.8'))).status, 200)
})

test('endpoint: un éxito reinicia el contador del cliente', async () => {
  const s = seed({ refreshExpiresAt: new Date(Date.now() + 86_400_000) })
  for (let i = 0; i < LIMIT_MAX_FAILURES - 1; i++) await tokenPost(refreshReq('malo'))
  assert.equal((await tokenPost(refreshReq(s.refreshToken))).status, 200)
  for (let i = 0; i < LIMIT_MAX_FAILURES - 1; i++) assert.equal((await tokenPost(refreshReq('malo'))).status, 400)
})

test('endpoint: el freno expira con la ventana', async () => {
  mock.timers.enable({ apis: ['Date'], now: T0 })
  for (let i = 0; i < LIMIT_MAX_FAILURES; i++) await tokenPost(refreshReq('malo'))
  assert.equal((await tokenPost(refreshReq('malo'))).status, 429)
  mock.timers.setTime(T0.getTime() + 61_000)
  assert.equal((await tokenPost(refreshReq('malo'))).status, 400)
})

test('endpoint: cuerpo enorme (aunque el refresh sea válido), JSON inválido y grant desconocido → 400 sin tocar la base', async () => {
  const s = seed({ refreshExpiresAt: new Date(Date.now() + 86_400_000) })
  const mk = (ct: string, body: string) => new NextRequest('https://x.test/oauth/token', { method: 'POST', headers: { 'content-type': ct }, body })
  const reqs = [
    mk('application/x-www-form-urlencoded', `grant_type=refresh_token&refresh_token=${s.refreshToken}&client_id=client-A&pad=${'x'.repeat(9000)}`),
    mk('application/json', '{no-json'),
    mk('application/x-www-form-urlencoded', 'grant_type=password'),
  ]
  for (const r of reqs) {
    const res = await tokenPost(r)
    assert.equal(res.status, 400)
    assert.equal(res.headers.get('cache-control'), 'no-store')
  }
  assert.equal(calls.findUnique, 0)
})

test('endpoint: refresh sin refresh_token → invalid_request (y no cuenta como fallo del freno)', async () => {
  for (let i = 0; i < LIMIT_MAX_FAILURES + 2; i++) {
    const res = await tokenPost(new NextRequest('https://x.test/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '5.5.5.5' }, body: 'grant_type=refresh_token&client_id=client-A' }))
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error, 'invalid_request')
  }
})

test('endpoint: un token válido NO se puede usar dos veces fuera de la ventana (la rotación sigue protegiendo)', async () => {
  const s = seed({ refreshExpiresAt: new Date(T0.getTime() + 86_400_000) })
  mock.timers.enable({ apis: ['Date'], now: T0 })
  assert.equal((await tokenPost(refreshReq(s.refreshToken))).status, 200)
  mock.timers.setTime(T0.getTime() + REFRESH_GRACE_MS + 5_000)
  assert.equal((await tokenPost(refreshReq(s.refreshToken, 'client-A', '4.4.4.4'))).status, 400)
})

// ── Metadatos RFC 9728 y 401 del MCP ───────────────────────────────────────────────────────────────────────────────
const prmReq = (path: string, headers: Record<string, string> = {}) => new NextRequest(`https://x.test${path}`, { headers })

test('metadatos: ambas rutas .well-known responden 200 con el recurso MCP y el servidor de autorización', async () => {
  const h = { 'x-forwarded-host': 'bitacora.example.com', 'x-forwarded-proto': 'https' }
  for (const [fn, p] of [[prmGet, '/.well-known/oauth-protected-resource'], [prmMcpGet, '/.well-known/oauth-protected-resource/api/mcp']] as const) {
    const res = await fn(prmReq(p, h))
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    assert.deepEqual(await res.json(), {
      resource: 'https://bitacora.example.com/api/mcp',
      authorization_servers: ['https://bitacora.example.com'],
      bearer_methods_supported: ['header'],
    })
  }
})

test('metadatos: el origen sale normalizado — un x-forwarded-host malicioso o inválido no cuela caracteres en el encabezado', () => {
  assert.equal(publicOrigin(new Headers({ 'x-forwarded-host': 'bitacora.example.com', 'x-forwarded-proto': 'https' })), 'https://bitacora.example.com')
  // host inválido → cae a APP_PUBLIC_URL
  assert.equal(publicOrigin(new Headers({ 'x-forwarded-host': 'ev il.com' })), 'https://bitacora.example.com')
  // esquema peligroso → cae a APP_PUBLIC_URL
  assert.equal(publicOrigin(new Headers({ 'x-forwarded-host': 'x.com', 'x-forwarded-proto': 'javascript' })), 'https://bitacora.example.com')
  // host con caracteres no ASCII → punycode ASCII
  assert.match(wwwAuthenticate(publicOrigin(new Headers({ 'x-forwarded-host': 'bitácora.example.com' }))), /^[\x20-\x7e]+$/)
})

test('metadatos: el documento no expone secretos ni datos internos', () => {
  const text = JSON.stringify(protectedResourceMetadata('https://bitacora.example.com'))
  assert.ok(!/token|secret|password|postgres|supabase/i.test(text))
})

test('401 del MCP: Bearer + resource_metadata, solo ASCII, y expone WWW-Authenticate a clientes en navegador', async () => {
  const res = await mcpPost(
    new NextRequest('https://x.test/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-host': 'bitacora.example.com', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
  )
  assert.equal(res.status, 401)
  const h = res.headers.get('www-authenticate')!
  assert.match(h, /^Bearer /)
  assert.match(h, /^[\x20-\x7e]+$/)
  assert.ok(h.includes('resource_metadata="https://bitacora.example.com/.well-known/oauth-protected-resource/api/mcp"'))
  assert.match(res.headers.get('access-control-expose-headers') ?? '', /WWW-Authenticate/i)
})
