import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { parseCsv, recordIdFromUrl, parseLegacyRows, importLegacyHistory, importAuditNotifications } from '@/lib/email/legacy-import'
import { sendNovedad } from '@/lib/email/service'
import { resetDb, ensureFields } from './helpers'
import { clearMailbox, listMessages } from './mailpit'
import { makeRecord, setMode, viewer, admin } from './email-helpers'

beforeEach(async () => {
  await resetDb()
  await ensureFields()
  await clearMailbox()
})

test('parseCsv: comillas, comas y saltos de línea dentro de campos, CRLF y BOM', () => {
  const csv = '﻿a,b,c\r\n1,"con, coma","línea1\nlínea2"\r\n"con ""comillas""",,fin\r\n\r\n'
  assert.deepEqual(parseCsv(csv), [['a', 'b', 'c'], ['1', 'con, coma', 'línea1\nlínea2'], ['con "comillas"', '', 'fin']])
  assert.deepEqual(parseCsv(''), [])
})

test('recordIdFromUrl: acepta el dominio viejo y el nuevo; rechaza lo que no sea un id', () => {
  assert.equal(recordIdFromUrl('https://bitacora-novedades.vercel.app/app?record=cmabc123'), 'cmabc123')
  assert.equal(recordIdFromUrl('https://bitacora-novedades.alegra.com/app?record=cm_x-1'), 'cm_x-1')
  for (const bad of ['', 'no es url', 'https://x.com/app', 'https://x.com/app?record=', "https://x.com/app?record=' OR 1=1", 'https://x.com/app?record=../../etc', 'https://x.com/app?record=' + 'a'.repeat(65)]) {
    assert.equal(recordIdFromUrl(bad), null, bad)
  }
})

test('parseLegacyRows: detecta encabezado, columnas y filas inválidas con su número de línea', () => {
  const csv = [
    'Fecha,,Elaborado,Tipo,Título,URL,Correos,Video',
    '2026-10-01 10:00:00,,ana@alegra.com,Novedad,Mi novedad,https://x.vercel.app/app?record=rec1,"a@alegra.com, B@alegra.com",',
    '2026-10-02 10:00:00,,x,Novedad,Sin link,sin-url,a@alegra.com,',
  ].join('\n')
  const r = parseLegacyRows(csv)
  assert.equal(r.total, 2)
  assert.equal(r.rows.length, 1)
  assert.deepEqual(r.rows[0].recipients, ['a@alegra.com', 'b@alegra.com'])
  assert.deepEqual(r.invalid, [{ line: 3, reason: 'La columna F no trae un link con ?record=<id>' }])
  // sin encabezado también funciona
  assert.equal(parseLegacyRows(csv.split('\n').slice(1).join('\n')).rows.length, 1)
})

test('simulacro (dry-run) no escribe nada; apply importa, es idempotente y reporta desconocidos', async () => {
  const a = await makeRecord({ titulo: 'A' })
  const b = await makeRecord({ titulo: 'B' })
  const csv = [
    'Fecha,,Elaborado,Tipo,Título,URL,Correos,Video',
    `2026-10-01 10:00:00,,ana@alegra.com,Novedad,A,https://x.vercel.app/app?record=${a.id},a@alegra.com,`,
    `2026-09-30 09:00:00,,luis@alegra.com,Novedad,A repetida mas antigua,https://x.vercel.app/app?record=${a.id},a@alegra.com,`,
    `2026-10-03 10:00:00,,ana@alegra.com,Novedad,B,https://x.alegra.com/app?record=${b.id},b@alegra.com,`,
    '2026-10-04 10:00:00,,ana@alegra.com,Novedad,Fantasma,https://x.alegra.com/app?record=no-existe,c@alegra.com,',
    '2026-10-05 10:00:00,,ana@alegra.com,Novedad,Rota,basura,c@alegra.com,',
  ].join('\n')

  const dry = await importLegacyHistory(csv, { apply: false })
  assert.deepEqual([dry.dryRun, dry.totalRows, dry.parsed, dry.duplicatesInFile, dry.toImport, dry.imported], [true, 5, 4, 1, 2, 0])
  assert.deepEqual(dry.unknownRecords, ['no-existe'])
  assert.equal(dry.invalidRows.length, 1)
  assert.equal(await prisma.emailDelivery.count(), 0, 'el simulacro no escribe')

  const done = await importLegacyHistory(csv, { apply: true })
  assert.equal(done.imported, 2)
  const rowA = await prisma.emailDelivery.findUniqueOrThrow({ where: { lockKey: `novedad:${a.id}` } })
  assert.deepEqual([rowA.mode, rowA.status, rowA.triggeredByEmail], ['legacy', 'sent', 'luis@alegra.com'], 'se conserva la primera comunicación')
  assert.equal(rowA.createdAt.getTime(), new Date('2026-09-30 09:00:00').getTime(), 'conserva la fecha original')

  const again = await importLegacyHistory(csv, { apply: true })
  assert.deepEqual([again.imported, again.alreadyImported, again.toImport], [0, 2, 0])
  assert.equal(await prisma.emailDelivery.count(), 2)
})

test('lo importado cuenta como ya enviado: la app no reenvía (auto ni manual) y solo se fuerza con un motivo', async () => {
  await setMode('live')
  const a = await makeRecord({ titulo: 'Ya comunicada' })
  await importLegacyHistory(`2026-10-01 10:00:00,,ana@alegra.com,Novedad,x,https://x.vercel.app/app?record=${a.id},a@alegra.com,`, { apply: true })

  assert.equal((await sendNovedad({ recordId: a.id, actor: viewer, channel: 'web', trigger: 'auto' })).skippedReason, 'ya_enviado')
  const manual = await sendNovedad({ recordId: a.id, actor: viewer, channel: 'web', trigger: 'manual' })
  assert.equal(manual.error?.code, 'DUPLICATE')
  assert.equal(manual.error?.previous?.by, 'ana@alegra.com')
  assert.equal((await listMessages()).length, 0)

  const noReason = await sendNovedad({ recordId: a.id, actor: viewer, channel: 'web', trigger: 'manual', resend: { reason: 'x' } })
  assert.equal(noReason.error?.code, 'VALIDATION')
  assert.equal((await listMessages()).length, 0)

  // cualquier usuario puede forzarlo si explica por qué
  const forced = await sendNovedad({ recordId: a.id, actor: viewer, channel: 'web', trigger: 'manual', resend: { reason: 'Corrección' } })
  assert.equal(forced.status, 'sent')
})

test('celdas con fórmulas o HTML se guardan como texto inerte y las fechas inválidas no rompen la importación', async () => {
  const a = await makeRecord()
  const csv = `no-es-fecha,,=cmd|' /C calc'!A0,<script>x</script>,@SUM(1+1),https://x.com/app?record=${a.id},a@alegra.com,`
  const r = await importLegacyHistory(csv, { apply: true })
  assert.equal(r.imported, 1)
  const row = await prisma.emailDelivery.findFirstOrThrow({ where: { recordId: a.id } })
  assert.ok(row.createdAt instanceof Date && !Number.isNaN(row.createdAt.getTime()))
  assert.equal(row.mode, 'legacy')
})

test('importAuditNotifications: convierte NOTIFIED_PMKT en historial visible, una vez por novedad e idempotente', async () => {
  const a = await makeRecord({ titulo: 'A' })
  const b = await makeRecord({ titulo: 'B' })
  for (const id of [a.id, a.id, b.id]) {
    await prisma.auditLog.create({ data: { userEmail: 'ana@alegra.com', userName: 'Ana', action: 'NOTIFIED_PMKT', recordId: id, details: { recipients: ['x@alegra.com'] } } })
  }
  const dry = await importAuditNotifications({ apply: false })
  assert.deepEqual(dry, { found: 2, imported: 0 })
  assert.equal(await prisma.emailDelivery.count(), 0)
  assert.deepEqual(await importAuditNotifications({ apply: true }), { found: 2, imported: 2 })
  assert.deepEqual(await importAuditNotifications({ apply: true }), { found: 2, imported: 0 })
  assert.equal((await prisma.emailDelivery.findFirstOrThrow({ where: { recordId: a.id } })).recipients[0], 'x@alegra.com')
})

// ---- Novedades que la versión anterior ya comunicó con el botón "Enviar email" (aparecen como "✅ Sí") ----

import { importButtonMarked } from '@/lib/email/legacy-import'
import { handleNotifyPmkt } from '@/lib/mcp/tools'
import { makeUser } from './helpers'

async function buttonField() {
  await prisma.field.deleteMany({ where: { type: 'button' } })
  return prisma.field.create({ data: { name: 'Enviar email', type: 'button', order: 999, config: { action: 'webhook', webhookUrl: 'http://127.0.0.1:9/x' } } })
}

test('novedad ya enviada con el botón (fecha en el campo): no se reenvía por ningún canal; se fuerza con un motivo', async () => {
  await setMode('live')
  const btn = await buttonField()
  try {
    const sent = await makeRecord({ titulo: 'Enviada con el botón' })
    const data = { ...((await prisma.record.findUniqueOrThrow({ where: { id: sent.id } })).data as Record<string, unknown>), [btn.id]: '2026-10-15T14:30:00.000Z' }
    await prisma.record.update({ where: { id: sent.id }, data: { data: data as never } })

    const auto = await sendNovedad({ recordId: sent.id, actor: viewer, channel: 'web', trigger: 'auto' })
    assert.equal(auto.skippedReason, 'ya_enviado')
    const manual = await sendNovedad({ recordId: sent.id, actor: viewer, channel: 'web', trigger: 'button' })
    assert.equal(manual.error?.code, 'DUPLICATE')
    assert.equal(manual.error?.previous?.sentAt, '2026-10-15T14:30:00.000Z')
    assert.equal(manual.error?.previous?.by, 'el botón «Enviar email»')

    // por MCP / API también (no solo en la pantalla)
    const u = await makeUser('ana@alegra.com', 'VIEWER')
    const viaMcp = (await handleNotifyPmkt({ recordId: sent.id, confirm: true }, { id: u.id, email: u.email, name: u.name, role: 'VIEWER' })) as { error: { code: string } }
    assert.equal(viaMcp.error.code, 'DUPLICATE')
    assert.equal((await listMessages()).length, 0, 'no salió ningún correo')

    // una novedad sin marca sigue pudiendo enviarse
    const fresh = await makeRecord({ titulo: 'Nueva' })
    assert.equal((await sendNovedad({ recordId: fresh.id, actor: viewer, channel: 'web', trigger: 'manual' })).status, 'sent')

    // y se puede reenviar la ya enviada, con motivo
    const forced = await sendNovedad({ recordId: sent.id, actor: viewer, channel: 'web', trigger: 'manual', resend: { reason: 'Corrección' } })
    assert.equal(forced.status, 'sent')
  } finally {
    await prisma.field.delete({ where: { id: btn.id } })
  }
})

test('novedad enviada con el botón de la versión anterior (WEBHOOK_TRIGGERED, aunque no tenga la marca) tampoco se reenvía', async () => {
  await setMode('live')
  const r = await makeRecord({ titulo: 'Solo auditoría' })
  await prisma.auditLog.create({ data: { userEmail: 'luis@alegra.com', userName: 'Luis', action: 'WEBHOOK_TRIGGERED', recordId: r.id, details: {} } })
  const manual = await sendNovedad({ recordId: r.id, actor: viewer, channel: 'web', trigger: 'manual' })
  assert.equal(manual.error?.code, 'DUPLICATE')
  assert.equal(manual.error?.previous?.by, 'luis@alegra.com')
  assert.equal((await sendNovedad({ recordId: r.id, actor: viewer, channel: 'web', trigger: 'auto' })).skippedReason, 'ya_enviado')
  assert.equal((await listMessages()).length, 0)
})

test('importButtonMarked: deja en el historial las novedades marcadas "Sí" sin fila de envío; simulacro no escribe; es idempotente', async () => {
  const btn = await buttonField()
  try {
    const a = await makeRecord({ titulo: 'A marcada' })
    const b = await makeRecord({ titulo: 'B sin marca' })
    const c = await makeRecord({ titulo: 'C marcada y ya con fila' })
    for (const [rec, val] of [[a, '2026-10-10T10:00:00.000Z'], [c, '2026-10-11T10:00:00.000Z']] as const) {
      const data = { ...((await prisma.record.findUniqueOrThrow({ where: { id: rec.id } })).data as Record<string, unknown>), [btn.id]: val }
      await prisma.record.update({ where: { id: rec.id }, data: { data: data as never } })
    }
    await prisma.emailDelivery.create({ data: { recordId: c.id, mode: 'live', status: 'sent', lockKey: `novedad:${c.id}`, channel: 'web', trigger: 'manual', triggeredByEmail: 'x@alegra.com' } })

    assert.deepEqual(await importButtonMarked({ apply: false }), { found: 1, imported: 0 })
    assert.equal(await prisma.emailDelivery.count(), 1, 'el simulacro no escribe')
    assert.deepEqual(await importButtonMarked({ apply: true }), { found: 1, imported: 1 })
    const row = await prisma.emailDelivery.findUniqueOrThrow({ where: { lockKey: `novedad:${a.id}` } })
    assert.deepEqual([row.mode, row.status, row.trigger], ['legacy', 'sent', 'button'])
    assert.equal(row.createdAt.toISOString(), '2026-10-10T10:00:00.000Z')
    assert.equal(await prisma.emailDelivery.count({ where: { recordId: b.id } }), 0)
    assert.deepEqual(await importButtonMarked({ apply: true }), { found: 0, imported: 0 })
  } finally {
    await prisma.field.delete({ where: { id: btn.id } })
  }
})
