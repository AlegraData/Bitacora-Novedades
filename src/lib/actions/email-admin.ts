'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth-utils'
import { getAdminState, saveSettings, verifyConnection, type AdminState, type AdminResult } from '@/lib/email/admin'
import type { EmailSettingsDTO, SettingsPatch } from '@/lib/email/settings'

// Todas estas acciones son solo para ADMIN. El actor sale siempre de la sesión del servidor.
async function admin() {
  const u = await requireAdmin()
  return { id: u.id, email: u.email, name: u.name }
}

export async function getEmailAdminState(): Promise<AdminState> {
  await requireAdmin()
  return getAdminState()
}

export async function saveEmailSettings(patch: SettingsPatch): Promise<AdminResult<EmailSettingsDTO>> {
  const res = await saveSettings(await admin(), patch)
  if (res.ok) revalidatePath('/admin')
  return res
}

export async function verifyEmailConnection() {
  await requireAdmin()
  return verifyConnection()
}
