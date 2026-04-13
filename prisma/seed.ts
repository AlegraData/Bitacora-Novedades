import 'dotenv/config'
// dotenv/config auto-loads .env; we also need .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { PrismaClient } from '../src/generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Limpiando datos anteriores de seed...')
  await prisma.record.deleteMany()
  await prisma.tag.deleteMany()
  await prisma.fieldPermission.deleteMany()
  await prisma.field.deleteMany()

  console.log('📋 Creando campos...')

  const fields = await Promise.all([
    prisma.field.create({
      data: {
        name: 'Título', type: 'text', order: 1, isFilterable: true, isVisible: true,
      },
    }),
    prisma.field.create({
      data: {
        name: 'Breve descripción', type: 'textarea', order: 2, isFilterable: false, isVisible: true,
      },
    }),
    prisma.field.create({
      data: {
        name: 'Fecha de lanzamiento', type: 'date', order: 3, isFilterable: true, isVisible: true,
      },
    }),
    prisma.field.create({
      data: {
        name: 'Tipo', type: 'select', order: 4, isFilterable: true, isVisible: true,
        options: {
          create: [
            { name: 'Novedad', color: '#c6f6d5', order: 0 },
            { name: 'Pre-novedad', color: '#bee3f8', order: 1 },
            { name: 'Mejora técnica', color: '#fefcbf', order: 2 },
            { name: 'Bug fix', color: '#fed7d7', order: 3 },
          ],
        },
      },
    }),
    prisma.field.create({
      data: {
        name: 'Elaborado', type: 'person', order: 5, isFilterable: true, isVisible: true,
      },
    }),
    prisma.field.create({
      data: {
        name: 'Responsables', type: 'multiselect', order: 6, isFilterable: true, isVisible: true,
        options: {
          create: [
            { name: 'ana.garcia@alegra.com', color: '#e9d8fd', order: 0 },
            { name: 'carlos.lopez@alegra.com', color: '#bee3f8', order: 1 },
            { name: 'maria.torres@alegra.com', color: '#c6f6d5', order: 2 },
            { name: 'juan.martinez@alegra.com', color: '#fed7d7', order: 3 },
            { name: 'sofia.ramirez@alegra.com', color: '#fefcbf', order: 4 },
          ],
        },
      },
    }),
    prisma.field.create({
      data: {
        name: 'Versión', type: 'multiselect', order: 7, isFilterable: true, isVisible: true,
        options: {
          create: [
            { name: '2.0', color: '#e2e8f0', order: 0 },
            { name: '2.1', color: '#e2e8f0', order: 1 },
            { name: '2.2', color: '#e2e8f0', order: 2 },
            { name: '2.3', color: '#e2e8f0', order: 3 },
            { name: '3.0', color: '#c6f6d5', order: 4 },
          ],
        },
      },
    }),
    prisma.field.create({
      data: {
        name: 'Producto', type: 'multiselect', order: 8, isFilterable: true, isVisible: true,
        options: {
          create: [
            { name: 'Alegra Contabilidad', color: '#bee3f8', order: 0 },
            { name: 'Alegra POS', color: '#c6f6d5', order: 1 },
            { name: 'Alegra Nómina', color: '#fefcbf', order: 2 },
            { name: 'Alegra Facturación', color: '#e9d8fd', order: 3 },
            { name: 'Alegra Inventario', color: '#fed7d7', order: 4 },
          ],
        },
      },
    }),
    prisma.field.create({
      data: {
        name: 'SH', type: 'select', order: 9, isFilterable: true, isVisible: true,
        options: {
          create: [
            { name: 'Comercial', color: '#fed7d7', order: 0 },
            { name: 'Marketing', color: '#fefcbf', order: 1 },
            { name: 'Soporte', color: '#bee3f8', order: 2 },
            { name: 'Customer Success', color: '#c6f6d5', order: 3 },
            { name: 'Operaciones', color: '#e9d8fd', order: 4 },
          ],
        },
      },
    }),
    prisma.field.create({
      data: {
        name: 'Correos a comunicar', type: 'multiselect', order: 10, isFilterable: true, isVisible: true,
        options: {
          create: [
            { name: 'equipo-producto@alegra.com', color: '#e2e8f0', order: 0 },
            { name: 'marketing@alegra.com', color: '#e2e8f0', order: 1 },
            { name: 'ventas@alegra.com', color: '#e2e8f0', order: 2 },
            { name: 'soporte@alegra.com', color: '#e2e8f0', order: 3 },
            { name: 'cs@alegra.com', color: '#e2e8f0', order: 4 },
          ],
        },
      },
    }),
    prisma.field.create({
      data: {
        name: 'Documentación', type: 'url', order: 11, isFilterable: false, isVisible: true,
      },
    }),
    prisma.field.create({
      data: {
        name: 'Video', type: 'url', order: 12, isFilterable: false, isVisible: true,
      },
    }),
    prisma.field.create({
      data: {
        name: 'URL Notion', type: 'url', order: 13, isFilterable: false, isVisible: true,
      },
    }),
    prisma.field.create({
      data: {
        name: 'Enviar email', type: 'checkbox', order: 14, isFilterable: true, isVisible: true,
      },
    }),
  ])

  const [
    fTitulo, fDescripcion, fFecha, fTipo, fElaborado,
    fResponsables, fVersion, fProducto, fSH, fCorreos,
    fDoc, fVideo, fUrl, fEnviarEmail,
  ] = fields

  console.log(`✅ ${fields.length} campos creados`)
  console.log('📝 Creando 10 registros de prueba...')

  const registros = [
    {
      data: {
        [fTitulo.id]: 'Nuevo módulo de reportes financieros',
        [fDescripcion.id]: 'Se implementó un módulo completo de reportes financieros con filtros por fecha, moneda y centro de costo. Incluye exportación a PDF y Excel.',
        [fFecha.id]: '2026-03-15',
        [fTipo.id]: 'Novedad',
        [fElaborado.id]: 'ana.garcia@alegra.com',
        [fResponsables.id]: ['carlos.lopez@alegra.com', 'maria.torres@alegra.com'],
        [fVersion.id]: ['2.3'],
        [fProducto.id]: ['Alegra Contabilidad'],
        [fSH.id]: 'Comercial',
        [fCorreos.id]: ['equipo-producto@alegra.com', 'ventas@alegra.com'],
        [fDoc.id]: 'https://docs.alegra.com/reportes-financieros',
        [fVideo.id]: 'https://loom.com/share/abc123',
        [fUrl.id]: 'https://notion.so/alegra/reportes-123',
        [fEnviarEmail.id]: true,
      },
      createdByEmail: 'ana.garcia@alegra.com',
      createdByName: 'Ana García',
    },
    {
      data: {
        [fTitulo.id]: 'Mejora en velocidad de carga del dashboard POS',
        [fDescripcion.id]: 'Se optimizó la carga inicial del dashboard de POS reduciendo el tiempo de carga de 4.2s a 0.8s mediante lazy loading y caché de consultas frecuentes.',
        [fFecha.id]: '2026-03-10',
        [fTipo.id]: 'Mejora técnica',
        [fElaborado.id]: 'carlos.lopez@alegra.com',
        [fResponsables.id]: ['carlos.lopez@alegra.com'],
        [fVersion.id]: ['2.2', '2.3'],
        [fProducto.id]: ['Alegra POS'],
        [fSH.id]: 'Operaciones',
        [fCorreos.id]: ['equipo-producto@alegra.com'],
        [fDoc.id]: 'https://docs.alegra.com/pos-performance',
        [fVideo.id]: null,
        [fUrl.id]: 'https://notion.so/alegra/pos-perf-456',
        [fEnviarEmail.id]: false,
      },
      createdByEmail: 'carlos.lopez@alegra.com',
      createdByName: 'Carlos López',
    },
    {
      data: {
        [fTitulo.id]: 'Integración con PSE para pagos en Colombia',
        [fDescripcion.id]: 'Habilitamos el pago a través de PSE directamente desde la plataforma. Los usuarios ya pueden configurar su cuenta bancaria y recibir pagos en línea.',
        [fFecha.id]: '2026-03-28',
        [fTipo.id]: 'Novedad',
        [fElaborado.id]: 'sofia.ramirez@alegra.com',
        [fResponsables.id]: ['sofia.ramirez@alegra.com', 'juan.martinez@alegra.com'],
        [fVersion.id]: ['3.0'],
        [fProducto.id]: ['Alegra Facturación', 'Alegra Contabilidad'],
        [fSH.id]: 'Comercial',
        [fCorreos.id]: ['marketing@alegra.com', 'ventas@alegra.com', 'soporte@alegra.com'],
        [fDoc.id]: 'https://docs.alegra.com/pse-integracion',
        [fVideo.id]: 'https://youtube.com/watch?v=xyz789',
        [fUrl.id]: 'https://notion.so/alegra/pse-789',
        [fEnviarEmail.id]: true,
      },
      createdByEmail: 'sofia.ramirez@alegra.com',
      createdByName: 'Sofía Ramírez',
    },
    {
      data: {
        [fTitulo.id]: 'Corrección en cálculo de retención en la fuente',
        [fDescripcion.id]: 'Se corrigió un bug donde la retención en la fuente no se calculaba correctamente cuando el comprobante tenía descuentos mayores al 15%.',
        [fFecha.id]: '2026-02-20',
        [fTipo.id]: 'Bug fix',
        [fElaborado.id]: 'juan.martinez@alegra.com',
        [fResponsables.id]: ['juan.martinez@alegra.com', 'ana.garcia@alegra.com'],
        [fVersion.id]: ['2.2'],
        [fProducto.id]: ['Alegra Contabilidad'],
        [fSH.id]: 'Soporte',
        [fCorreos.id]: ['soporte@alegra.com', 'cs@alegra.com'],
        [fDoc.id]: null,
        [fVideo.id]: null,
        [fUrl.id]: 'https://notion.so/alegra/bug-retencion-101',
        [fEnviarEmail.id]: false,
      },
      createdByEmail: 'juan.martinez@alegra.com',
      createdByName: 'Juan Martínez',
    },
    {
      data: {
        [fTitulo.id]: 'Pre-novedad: Módulo de nómina electrónica DIAN',
        [fDescripcion.id]: 'En desarrollo: integración con la plataforma de nómina electrónica de la DIAN para generación automática de comprobantes. Lanzamiento estimado en abril.',
        [fFecha.id]: '2026-04-15',
        [fTipo.id]: 'Pre-novedad',
        [fElaborado.id]: 'maria.torres@alegra.com',
        [fResponsables.id]: ['maria.torres@alegra.com', 'carlos.lopez@alegra.com'],
        [fVersion.id]: ['3.0'],
        [fProducto.id]: ['Alegra Nómina'],
        [fSH.id]: 'Customer Success',
        [fCorreos.id]: ['equipo-producto@alegra.com', 'marketing@alegra.com'],
        [fDoc.id]: 'https://docs.alegra.com/nomina-electronica-preview',
        [fVideo.id]: null,
        [fUrl.id]: 'https://notion.so/alegra/nomina-dian-202',
        [fEnviarEmail.id]: false,
      },
      createdByEmail: 'maria.torres@alegra.com',
      createdByName: 'María Torres',
    },
    {
      data: {
        [fTitulo.id]: 'Nuevo selector de bodegas en Inventario',
        [fDescripcion.id]: 'Se agregó un selector rápido de bodegas en la barra superior del módulo de inventario, permitiendo cambiar el contexto sin navegar al menú de configuración.',
        [fFecha.id]: '2026-03-05',
        [fTipo.id]: 'Novedad',
        [fElaborado.id]: 'carlos.lopez@alegra.com',
        [fResponsables.id]: ['carlos.lopez@alegra.com', 'sofia.ramirez@alegra.com'],
        [fVersion.id]: ['2.3'],
        [fProducto.id]: ['Alegra Inventario', 'Alegra POS'],
        [fSH.id]: 'Comercial',
        [fCorreos.id]: ['ventas@alegra.com', 'cs@alegra.com'],
        [fDoc.id]: 'https://docs.alegra.com/selector-bodegas',
        [fVideo.id]: 'https://loom.com/share/def456',
        [fUrl.id]: 'https://notion.so/alegra/selector-bodegas-303',
        [fEnviarEmail.id]: true,
      },
      createdByEmail: 'carlos.lopez@alegra.com',
      createdByName: 'Carlos López',
    },
    {
      data: {
        [fTitulo.id]: 'Soporte multi-moneda en cotizaciones',
        [fDescripcion.id]: 'Las cotizaciones ahora soportan múltiples monedas con tasas de cambio en tiempo real obtenidas del Banco de la República. Se pueden emitir cotizaciones en USD, EUR y COP.',
        [fFecha.id]: '2026-02-28',
        [fTipo.id]: 'Novedad',
        [fElaborado.id]: 'ana.garcia@alegra.com',
        [fResponsables.id]: ['ana.garcia@alegra.com', 'juan.martinez@alegra.com'],
        [fVersion.id]: ['2.3', '3.0'],
        [fProducto.id]: ['Alegra Facturación', 'Alegra Contabilidad'],
        [fSH.id]: 'Marketing',
        [fCorreos.id]: ['marketing@alegra.com', 'ventas@alegra.com', 'equipo-producto@alegra.com'],
        [fDoc.id]: 'https://docs.alegra.com/multi-moneda',
        [fVideo.id]: 'https://youtube.com/watch?v=multimoneda',
        [fUrl.id]: 'https://notion.so/alegra/multi-moneda-404',
        [fEnviarEmail.id]: true,
      },
      createdByEmail: 'ana.garcia@alegra.com',
      createdByName: 'Ana García',
    },
    {
      data: {
        [fTitulo.id]: 'Mejora UX en formulario de facturación',
        [fDescripcion.id]: 'Se rediseñó el formulario de creación de facturas con autocompletado inteligente de clientes, productos y precios. Reducción del 40% en tiempo de creación.',
        [fFecha.id]: '2026-03-20',
        [fTipo.id]: 'Mejora técnica',
        [fElaborado.id]: 'sofia.ramirez@alegra.com',
        [fResponsables.id]: ['sofia.ramirez@alegra.com'],
        [fVersion.id]: ['2.3'],
        [fProducto.id]: ['Alegra Facturación'],
        [fSH.id]: 'Customer Success',
        [fCorreos.id]: ['cs@alegra.com', 'soporte@alegra.com'],
        [fDoc.id]: 'https://docs.alegra.com/ux-facturacion',
        [fVideo.id]: 'https://loom.com/share/ghi789',
        [fUrl.id]: 'https://notion.so/alegra/ux-facturacion-505',
        [fEnviarEmail.id]: false,
      },
      createdByEmail: 'sofia.ramirez@alegra.com',
      createdByName: 'Sofía Ramírez',
    },
    {
      data: {
        [fTitulo.id]: 'API pública v3 para integraciones externas',
        [fDescripcion.id]: 'Lanzamos la versión 3 de nuestra API pública con soporte para webhooks, rate limiting mejorado y documentación OpenAPI 3.1. Compatible con las integraciones existentes.',
        [fFecha.id]: '2026-04-01',
        [fTipo.id]: 'Novedad',
        [fElaborado.id]: 'juan.martinez@alegra.com',
        [fResponsables.id]: ['juan.martinez@alegra.com', 'carlos.lopez@alegra.com', 'ana.garcia@alegra.com'],
        [fVersion.id]: ['3.0'],
        [fProducto.id]: ['Alegra Contabilidad', 'Alegra Facturación', 'Alegra Nómina'],
        [fSH.id]: 'Comercial',
        [fCorreos.id]: ['equipo-producto@alegra.com', 'marketing@alegra.com', 'ventas@alegra.com'],
        [fDoc.id]: 'https://developers.alegra.com/api/v3',
        [fVideo.id]: 'https://youtube.com/watch?v=apiv3',
        [fUrl.id]: 'https://notion.so/alegra/api-v3-606',
        [fEnviarEmail.id]: true,
      },
      createdByEmail: 'juan.martinez@alegra.com',
      createdByName: 'Juan Martínez',
    },
    {
      data: {
        [fTitulo.id]: 'Pre-novedad: Dashboard analítico de ventas con IA',
        [fDescripcion.id]: 'En desarrollo: nuevo dashboard con predicciones de ventas basadas en historial, alertas de tendencias y recomendaciones automáticas. Beta cerrada próximamente.',
        [fFecha.id]: '2026-05-01',
        [fTipo.id]: 'Pre-novedad',
        [fElaborado.id]: 'maria.torres@alegra.com',
        [fResponsables.id]: ['maria.torres@alegra.com', 'sofia.ramirez@alegra.com'],
        [fVersion.id]: ['3.0'],
        [fProducto.id]: ['Alegra Contabilidad', 'Alegra POS'],
        [fSH.id]: 'Marketing',
        [fCorreos.id]: ['marketing@alegra.com', 'cs@alegra.com'],
        [fDoc.id]: 'https://docs.alegra.com/dashboard-ia-preview',
        [fVideo.id]: null,
        [fUrl.id]: 'https://notion.so/alegra/dashboard-ia-707',
        [fEnviarEmail.id]: false,
      },
      createdByEmail: 'maria.torres@alegra.com',
      createdByName: 'María Torres',
    },
  ]

  for (const reg of registros) {
    await prisma.record.create({ data: reg })
  }

  console.log('✅ 10 registros creados exitosamente')
  console.log('\n📊 Resumen:')
  console.log(`   Campos:   ${fields.length}`)
  console.log(`   Registros: ${registros.length}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
