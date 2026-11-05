// /api/monitor/status — casos de seguridad. El endpoint lo consulta el monitor del IT Hub con un token OIDC; la app es
// pública en Cloud Run (--allow-unauthenticated), así que TODA la protección está en este manejador.
// Se prueba con dependencias inyectadas: sin base de datos ni red.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMonitorStatusHandler, isMonitorPayload, buildMonitorStatus, type MonitorDeps, type TokenPayload } from '@/lib/monitor-status'
import { config as proxyConfig } from '@/proxy'

const SA = 'monitor@data-it-app-ithub-alegra.iam.gserviceaccount.com'
const AUDIENCE = 'https://bitacora-novedades.alegra.com'
const DB_SECRET = 'postgresql://admin:SuperSecreto@db.interno.example:5432/bitacora'

function setup(over: Partial<{ payload: TokenPayload; verifyError: Error; dbError: Error; dbDelayMs: number; cfg: ReturnType<MonitorDeps['config']> }> = {}) {
  const calls = { verify: [] as Array<[string, string]>, db: 0 }
  const handler = createMonitorStatusHandler({
    verifyToken: async (token, audience) => {
      calls.verify.push([token, audience])
      if (over.verifyError) throw over.verifyError
      return 'payload' in over ? over.payload : { email: SA, email_verified: true }
    },
    checkDatabase: async () => {
      calls.db++
      if (over.dbDelayMs) await new Promise((r) => setTimeout(r, over.dbDelayMs))
      if (over.dbError) throw over.dbError
    },
    config: () => over.cfg ?? { monitorSaEmail: SA, audience: AUDIENCE, version: 'bitacora-app-00038-abc' },
    checkTimeoutMs: 50,
  })
  const call = (headers: Record<string, string> = { authorization: 'Bearer tok' }) =>
    handler(new Request('https://x.test/api/monitor/status', { headers }))
  return { call, calls }
}

async function assertRejected(res: Response, calls: { verify: unknown[]; db: number }) {
  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), { error: 'No autorizado' })
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(calls.db, 0, 'no se debe tocar la base antes de autenticar')
}

test('sin cabecera Authorization → 401 y no se valida nada', async () => {
  const { call, calls } = setup()
  await assertRejected(await call({}), calls)
  assert.equal(calls.verify.length, 0)
})

for (const h of ['Basic dXNlcjpwYXNz', 'Bearer', 'Bearer ', 'Token abc', 'bearerabc', 'Bearer a b']) {
  test(`esquema o formato inválido (${JSON.stringify(h)}) → 401 sin tocar la base`, async () => {
    const { call, calls } = setup()
    await assertRejected(await call({ authorization: h }), calls)
  })
}

test('token que Google no valida (firma, expiración o audiencia) → 401 y el error no se filtra', async () => {
  const { call, calls } = setup({ verifyError: new Error(`Invalid token signature ${DB_SECRET}`) })
  const res = await call()
  await assertRejected(res, calls)
})

test('token de OTRA cuenta de servicio → 401', async () => {
  const { call, calls } = setup({ payload: { email: 'otra@proyecto.iam.gserviceaccount.com', email_verified: true } })
  await assertRejected(await call(), calls)
})

for (const [label, payload] of [
  ['correo sin verificar (false)', { email: SA, email_verified: false }],
  ['correo sin el campo email_verified', { email: SA }],
  ['email_verified como cadena "true"', { email: SA, email_verified: 'true' as unknown as boolean }],
  ['sin email', { email_verified: true }],
  ['payload vacío', undefined],
] as Array<[string, TokenPayload]>) {
  test(`${label} → 401`, async () => {
    const { call, calls } = setup({ payload })
    await assertRejected(await call(), calls)
  })
}

test('sin MONITOR_SA_EMAIL configurada el endpoint queda cerrado, aunque el token sea válido', async () => {
  const { call, calls } = setup({ cfg: { audience: AUDIENCE } })
  await assertRejected(await call(), calls)
  assert.equal(calls.verify.length, 0)
})

test('MONITOR_SA_EMAIL vacía también cierra el endpoint', async () => {
  const { call, calls } = setup({ cfg: { monitorSaEmail: '', audience: AUDIENCE } })
  await assertRejected(await call(), calls)
})

test('sin audiencia configurada el endpoint queda cerrado', async () => {
  const { call, calls } = setup({ cfg: { monitorSaEmail: SA } })
  await assertRejected(await call(), calls)
})

test('la audiencia sale de la configuración, no de la petición (Host o cabeceras falsas no la cambian)', async () => {
  const { call, calls } = setup()
  await call({ authorization: 'Bearer tok', host: 'evil.example', 'x-forwarded-host': 'evil.example' })
  assert.deepEqual(calls.verify, [['tok', AUDIENCE]])
})

test('todas las causas de rechazo responden exactamente igual', async () => {
  const bodies = new Set<string>()
  const fingerprint = async (res: Response) => JSON.stringify([res.status, await res.text(), [...res.headers.entries()].sort()])
  for (const s of [
    setup({ verifyError: new Error('firma inválida') }),
    setup({ verifyError: new Error('audiencia incorrecta') }),
    setup({ payload: { email: 'otra@x.iam.gserviceaccount.com', email_verified: true } }),
    setup({ payload: { email: SA, email_verified: false } }),
    setup({ cfg: {} }),
  ]) {
    bodies.add(await fingerprint(await s.call()))
  }
  bodies.add(await fingerprint(await setup().call({})))
  assert.equal(bodies.size, 1, 'el atacante no debe poder distinguir por qué se rechazó')
})

test('cuenta correcta → 200, estado ok, versión y no-store', async () => {
  const { call, calls } = setup()
  const res = await call()
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  const body = await res.json()
  assert.equal(body.status, 'ok')
  assert.equal(body.version, 'bitacora-app-00038-abc')
  assert.equal(body.checks[0].name, 'database')
  assert.equal(body.checks[0].status, 'ok')
  assert.deepEqual(body.jobs, [])
  assert.equal(calls.db, 1)
})

test('el correo se compara sin distinguir mayúsculas', async () => {
  const { call } = setup({ payload: { email: SA.toUpperCase(), email_verified: true } })
  assert.equal((await call()).status, 200)
})

test('base de datos caída → status down y detalle genérico (el mensaje de Prisma no se filtra)', async () => {
  const { call } = setup({ dbError: new Error(`Can't reach database server at ${DB_SECRET}`) })
  const res = await call()
  assert.equal(res.status, 200)
  const text = await res.text()
  const body = JSON.parse(text)
  assert.equal(body.status, 'down')
  assert.equal(body.checks[0].detail, 'error')
  assert.ok(!text.includes('SuperSecreto') && !text.includes('db.interno'))
})

test('base de datos colgada → se corta por timeout y se informa como down', async () => {
  const { call } = setup({ dbDelayMs: 500 })
  const started = Date.now()
  const body = await (await call()).json()
  assert.ok(Date.now() - started < 400, 'no debe esperar a la base colgada')
  assert.equal(body.checks[0].detail, 'timeout')
  assert.equal(body.status, 'down')
})

test('la respuesta no expone variables de entorno ni datos de negocio', async () => {
  const { call } = setup()
  const text = await (await call()).text()
  assert.ok(!/postgres|password|secret|api[_-]?key|token/i.test(text))
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['checks', 'freshness', 'jobs', 'status', 'version'])
})

test('isMonitorPayload: sin correo esperado nadie entra', () => {
  assert.equal(isMonitorPayload({ email: SA, email_verified: true }, undefined), false)
  assert.equal(isMonitorPayload({ email: SA, email_verified: true }, ''), false)
})

test('buildMonitorStatus: degraded si hay un check degradado o un job con problema; down gana', () => {
  assert.equal(buildMonitorStatus({ checks: [{ name: 'a', status: 'degraded' }], jobs: [], version: null }).status, 'degraded')
  assert.equal(buildMonitorStatus({ checks: [{ name: 'a', status: 'ok' }], jobs: [{ name: 'j', ok: false, lastRunAt: null }], version: null }).status, 'degraded')
  assert.equal(buildMonitorStatus({ checks: [{ name: 'a', status: 'down' }, { name: 'b', status: 'degraded' }], jobs: [], version: null }).status, 'down')
})

test('el proxy de Supabase NO intercepta /api/monitor/ (la sonda no depende de Supabase Auth) pero sí las páginas', () => {
  const re = new RegExp('^' + proxyConfig.matcher[0].replace(/^\//, '/') + '$')
  assert.equal(re.test('/api/monitor/status'), false)
  assert.equal(re.test('/app'), true)
  assert.equal(re.test('/admin'), true)
  assert.equal(re.test('/api/mcp'), true)
})
