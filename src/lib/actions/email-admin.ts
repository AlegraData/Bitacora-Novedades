'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth-utils'
import {
  getAdminState, saveSettings, verifyConnection, getTemplateState, previewTemplate, saveTemplateRun,
  restoreDefaultRun, restoreRevisionRun, getRevisionRun, listRecentNovedades,
  type AdminState, type AdminResult, type TemplateState, type PreviewResult, type NovedadOption,
} from '@/lib/email/admin'
import type { EmailSettingsDTO, SettingsPatch } from '@/lib/email/settings'
import type { TemplateDTO } from '@/lib/email/template-store'

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

export async function getEmailTemplateState(): Promise<TemplateState> {
  await requireAdmin()
  return getTemplateState()
}

export async function previewEmailTemplate(input: { subject: string; html: string; recordId?: string }): Promise<AdminResult<PreviewResult>> {
  await requireAdmin()
  return previewTemplate(input)
}

export async function saveEmailTemplate(input: { subject: string; html: string }): Promise<AdminResult<TemplateDTO>> {
  return saveTemplateRun(await admin(), input)
}

export async function restoreEmailTemplateDefault(): Promise<AdminResult<TemplateDTO>> {
  return restoreDefaultRun(await admin())
}

export async function restoreEmailTemplateRevision(version: number): Promise<AdminResult<TemplateDTO>> {
  return restoreRevisionRun(await admin(), version)
}

export async function getEmailTemplateRevision(version: number) {
  await requireAdmin()
  return getRevisionRun(version)
}

export async function listNovedadesForEmail(): Promise<NovedadOption[]> {
  await requireAdmin()
  return listRecentNovedades()
}
