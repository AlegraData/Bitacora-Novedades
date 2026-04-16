/**
 * sync-schema.ts
 * Agrega campos faltantes y opciones faltantes a la base de datos
 * sin borrar datos existentes. Es idempotente: puede ejecutarse varias veces.
 *
 * Ejecutar: npx tsx prisma/sync-schema.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { PrismaClient } from '../src/generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function addMissingOptions(
  fieldId: string,
  newOpts: { name: string; color: string }[]
) {
  const existing = await prisma.tag.findMany({ where: { fieldId } })
  const existingNames = new Set(existing.map((t) => t.name))
  let order = existing.reduce((m, t) => Math.max(m, t.order), -1) + 1
  let added = 0
  for (const opt of newOpts) {
    if (!existingNames.has(opt.name)) {
      await prisma.tag.create({
        data: { fieldId, name: opt.name, color: opt.color, order: order++ },
      })
      console.log(`      + "${opt.name}"`)
      added++
    }
  }
  if (added === 0) console.log('      (sin cambios)')
}

async function ensureField(
  name: string,
  type: string,
  order: number,
  isFilterable: boolean,
  isVisible: boolean,
  options?: { name: string; color: string }[]
): Promise<void> {
  const existing = await prisma.field.findFirst({ where: { name } })
  if (existing) {
    console.log(`  ⏭  "${name}" ya existe — actualizando opciones`)
    if (options?.length) await addMissingOptions(existing.id, options)
    return
  }
  const field = await prisma.field.create({
    data: { name, type, order, isFilterable, isVisible },
  })
  console.log(`  ✅ "${name}" creado (${type})`)
  if (options?.length) {
    let ord = 0
    for (const opt of options) {
      await prisma.tag.create({
        data: { fieldId: field.id, name: opt.name, color: opt.color, order: ord++ },
      })
    }
    console.log(`     ${options.length} opciones creadas`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🔄 Sincronizando esquema con el CSV...\n')

  const allFields = await prisma.field.findMany({ orderBy: { order: 'asc' } })
  const byName = new Map(allFields.map((f) => [f.name, f]))
  const maxOrder = allFields.reduce((m, f) => Math.max(m, f.order), 0)
  let next = maxOrder + 1

  // ── 1. Actualizar opciones de campos existentes ─────────────────────────

  console.log('📝 Actualizando opciones de campos existentes...\n')

  // Tipo
  const fTipo = byName.get('Tipo')
  if (fTipo) {
    console.log('  Tipo:')
    await addMissingOptions(fTipo.id, [
      { name: 'Pre novedad',        color: '#bee3f8' },
      { name: 'Novedades pequeñas', color: '#e9d8fd' },
      { name: 'Experimento',        color: '#fefcbf' },
      { name: 'Normativa',          color: '#fbd38d' },
      { name: 'Resolución de Issues', color: '#fed7d7' },
    ])
  }

  // SH — los valores del seed eran placeholders; los del CSV son los reales
  const fSH = byName.get('SH')
  if (fSH) {
    console.log('  SH:')
    const shValues = [
      'Ledger', 'Mobile', 'Reactivation', 'Synchronization', 'Onboarding General',
      'Income', 'Expenses', 'Integraciones', 'Accounting Process', 'Reportes',
      'Contacts', 'Items', 'Banks', 'Smile', 'Contador', 'Payments',
      'Communication Tools', 'Conversión & Loyalty', 'Identity', 'Ecosistema',
      'POS', 'Invoicing', 'Activation',
    ]
    await addMissingOptions(fSH.id, shValues.map((name) => ({ name, color: '#e2e8f0' })))
  }

  // Versión — el CSV usa países/regiones, no números de versión
  const fVersion = byName.get('Versión')
  if (fVersion) {
    console.log('  Versión:')
    await addMissingOptions(fVersion.id, [
      { name: 'All',              color: '#bee3f8' },
      { name: 'Colombia',         color: '#c6f6d5' },
      { name: 'México',           color: '#fefcbf' },
      { name: 'Costa Rica',       color: '#b2f5ea' },
      { name: 'Dominicana',       color: '#e9d8fd' },
      { name: 'España',           color: '#fbd38d' },
      { name: 'Panamá',           color: '#c3dafe' },
      { name: 'Argentina',        color: '#fbb6ce' },
      { name: 'Perú',             color: '#fed7d7' },
      { name: 'Internacional',    color: '#e2e8f0' },
      { name: 'Gestión interna',  color: '#e2e8f0' },
    ])
  }

  // Producto
  const fProducto = byName.get('Producto')
  if (fProducto) {
    console.log('  Producto:')
    await addMissingOptions(fProducto.id, [
      { name: 'Transversal', color: '#e2e8f0' },
      { name: 'Engagement',  color: '#fefcbf' },
    ])
  }

  // Correos a comunicar — los del seed eran placeholders
  const fCorreos = byName.get('Correos a comunicar')
  if (fCorreos) {
    console.log('  Correos a comunicar:')
    const correos = [
      'notificacion-novedad@alegra.com',
      'notificacion-prenovedad@alegra.com',
      'tm-product@alegra.com',
      'tm-cs@alegra.com',
      'tm-sales@alegra.com',
      'tm-development@alegra.com',
      'tm-growth@alegra.com',
      'tm-data@alegra.com',
      'tm-alegra@alegra.com',
      'sh-reports@alegra.com',
      'sh-contacts@alegra.com',
      'sh-banks@alegra.com',
      'sh-ledger@alegra.com',
      'sh-income@alegra.com',
      'sh-collection@alegra.com',
      'sh-membership@alegra.com',
      'sh-retention@alegra.com',
      'tms-cri@alegra.com',
      'tms-mex@alegra.com',
      'tms-dom@alegra.com',
      'tms-col@alegra.com',
      'tms-esp@alegra.com',
      'tms-pan@alegra.com',
      'tms-peru@alegra.com',
      'tms-arg@alegra.com',
      'tts-countries-cs@alegra.com',
      'tts-mex-cs@alegra.com',
      'tts-dom-cs@alegra.com',
      'tmd-col@alegra.com',
      'tmd-onboarding@alegra.com',
      'tmd-payments-cs@alegra.com',
    ]
    await addMissingOptions(fCorreos.id, correos.map((name) => ({ name, color: '#e2e8f0' })))
  }

  // ── 2. Crear campos nuevos ───────────────────────────────────────────────

  console.log('\n📋 Creando campos nuevos...\n')

  await ensureField('Necesita comunicación de Product Marketing', 'select', next++, true, true, [
    { name: 'SI', color: '#c6f6d5' },
    { name: 'NO', color: '#fed7d7' },
  ])

  await ensureField('Usuario impactado', 'multiselect', next++, true, true, [
    { name: 'Contador', color: '#bee3f8' },
    { name: 'Ambos',    color: '#c6f6d5' },
    { name: 'Lite',     color: '#fefcbf' },
    { name: 'Core',     color: '#e9d8fd' },
  ])

  await ensureField('Taxonomia Feature', 'multiselect', next++, true, true, [
    'Ledger', 'Income', 'Expenses', 'Banks', 'Synchronization',
    'Accounting Process', 'Reportes', 'Contacts', 'Items',
    'Onboarding General', 'Payments', 'Communication Tools',
    'Conversion & Loyalty', 'Identity', 'Ecosistema', 'POS',
    'Invoicing', 'Activation', 'Integraciones', 'Payroll',
    'Smile', 'Reactivation', 'Contador', 'income-Pan-Mex',
  ].map((name) => ({ name, color: '#e2e8f0' })))

  await ensureField('Evento Feature Amplitude', 'text',     next++, true,  true)
  await ensureField('Comentario evento',         'textarea', next++, false, true)
  await ensureField('Link Tablero Amplitude',    'url',      next++, false, true)
  await ensureField('Manual de Usuario',         'url',      next++, false, true)
  await ensureField('Artículo Help Center',      'url',      next++, false, true)

  await ensureField('Status', 'select', next++, true, true, [
    { name: 'Si',                                    color: '#c6f6d5' },
    { name: 'En construcción',                       color: '#fefcbf' },
    { name: 'Pendiente por publicar',                color: '#bee3f8' },
    { name: 'Creando contenido',                     color: '#fbd38d' },
    { name: 'Esperando confirmación para publicar',  color: '#e9d8fd' },
    { name: 'No se ha solicitado',                   color: '#e2e8f0' },
  ])

  await ensureField('IA', 'select', next++, true, true, [
    { name: 'NO',       color: '#e2e8f0' },
    { name: 'SI',       color: '#c6f6d5' },
    { name: 'AGENTE IA', color: '#e9d8fd' },
  ])

  await ensureField('Información Board', 'url', next++, false, true)

  console.log('\n✅ Sincronización completada!')

  const totalFields = await prisma.field.count()
  const totalTags   = await prisma.tag.count()
  console.log(`   Campos en DB:  ${totalFields}`)
  console.log(`   Opciones en DB: ${totalTags}`)
}

main()
  .catch((e) => { console.error('❌ Error:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
