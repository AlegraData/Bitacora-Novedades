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

test('lo importado cuenta como ya enviado: la app no reenvía (auto ni manual) y solo un ADMIN puede forzarlo', async () => {
  await setMode('live')
  const a = await makeRecord({ titulo: 'Ya comunicada' })
  await importLegacyHistory(`2026-10-01 10:00:00,,ana@alegra.com,Novedad,x,https://x.vercel.app/app?record=${a.id},a@alegra.com,`, { apply: true })

  assert.equal((await sendNovedad({ recordId: a.id, actor: viewer, channel: 'web', trigger: 'auto' })).skippedReason, 'ya_enviado')
  const manual = await sendNovedad({ recordId: a.id, actor: viewer, channel: 'web', trigger: 'manual' })
  assert.equal(manual.error?.code, 'DUPLICATE')
  assert.equal(manual.error?.previous?.by, 'ana@alegra.com')
  assert.equal((await listMessages()).length, 0)

  const forced = await sendNovedad({ recordId: a.id, actor: admin, channel: 'web', trigger: 'manual', resend: { reason: 'Corrección' } })
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
