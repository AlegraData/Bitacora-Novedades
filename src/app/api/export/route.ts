import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const format = searchParams.get('format') ?? 'csv'

  const [rawFields, rawRecords] = await Promise.all([
    prisma.field.findMany({ orderBy: { order: 'asc' } }),
    prisma.record.findMany({ orderBy: { createdAt: 'desc' } }),
  ])

  const visibleFields = rawFields.filter((f) => f.isVisible && f.type !== 'button')

  const headers = [
    'ID',
    'Creado por',
    'Fecha creación',
    ...visibleFields.map((f) => f.name),
  ]

  const rows = rawRecords.map((r) => {
    const data = r.data as Record<string, unknown>
    return [
      r.id,
      r.createdByName,
      r.createdAt.toISOString(),
      ...visibleFields.map((f) => {
        const val = data[f.id]
        if (Array.isArray(val)) return val.join(', ')
        return String(val ?? '')
      }),
    ]
  })

  const sheetData = [headers, ...rows]

  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(sheetData)
    XLSX.utils.book_append_sheet(wb, ws, 'Bitácora')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    return new Response(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="bitacora.xlsx"',
      },
    })
  }

  // CSV
  const csv = sheetData
    .map((row) =>
      row
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(',')
    )
    .join('\n')

  return new Response('\uFEFF' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bitacora.csv"',
    },
  })
}
