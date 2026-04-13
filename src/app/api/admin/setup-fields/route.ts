import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

/**
 * One-time setup route. Call once (while logged in) at:
 *   GET /api/admin/setup-fields
 *
 * What it does:
 *  1. Elaborado  → person type, multiple: false (single person only)
 *  2. Responsables → person type, multiple: true (search picker, multi)
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const results: Record<string, unknown> = {}

  // ── 1. Elaborado: ensure person type, single person ────────────────────────
  const elaborado = await prisma.field.findFirst({ where: { name: 'Elaborado' } })
  if (elaborado) {
    await prisma.field.update({
      where: { id: elaborado.id },
      data: {
        type: 'person',
        config: { multiple: false },
      },
    })
    results['Elaborado'] = { id: elaborado.id, type: 'person', config: { multiple: false } }
  } else {
    results['Elaborado'] = 'NOT FOUND'
  }

  // ── 2. Responsables: convert to person type, multiple allowed ──────────────
  const responsables = await prisma.field.findFirst({ where: { name: 'Responsables' } })
  if (responsables) {
    await prisma.field.update({
      where: { id: responsables.id },
      data: {
        type: 'person',
        config: { multiple: true },
      },
    })
    // Ensure ADMIN + MANAGER can edit
    for (const role of ['ADMIN', 'MANAGER'] as const) {
      await prisma.fieldPermission.upsert({
        where: { fieldId_role: { fieldId: responsables.id, role } },
        update: { canEdit: true },
        create: { fieldId: responsables.id, role, canEdit: true },
      })
    }
    results['Responsables'] = {
      id: responsables.id,
      type: 'person',
      config: { multiple: true },
      permissions: 'ADMIN + MANAGER canEdit=true',
    }
  } else {
    results['Responsables'] = 'NOT FOUND'
  }

  return NextResponse.json({ ok: true, results })
}
