import { EmailSendError } from './errors'
import { TemplateError } from './render'
import { getSettings, updateSettings, MODE_LABELS, DELIVERY_MODES, MAX_TEST_RECIPIENTS, allowedTestDomains, type EmailSettingsDTO, type SettingsActor, type SettingsPatch, type DeliveryMode } from './settings'
import { smtpStatus, verifySmtp } from './transport'
import { findWebhookButton } from './service'
import { publicAppUrl } from './variables'

import { prisma } from '@/lib/prisma'
import { loadFieldMap, mapRecordData } from '@/lib/mcp/fields'
import { renderEmail, validateTemplate } from './render'
import { buildVariables, sampleVariables, VARIABLE_DOCS } from './variables'
import { DEFAULT_HTML, DEFAULT_SUBJECT } from './default-template'
import {
  getActiveTemplate, saveTemplate, restoreDefault, restoreRevision, listRevisions, getRevision,
  type TemplateDTO, type RevisionDTO,
} from './template-store'

export type AdminResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; detail?: string }

/** Convierte los errores de negocio en un resultado que la pantalla puede mostrar tal cual. */
export async function run<T>(fn: () => Promise<T>): Promise<AdminResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    if (e instanceof EmailSendError) return { ok: false, error: e.info.message, code: e.info.code, detail: e.info.detail }
    if (e instanceof TemplateError) return { ok: false, error: e.message, code: 'TEMPLATE' }
    console.error('[email-admin] error inesperado:', e)
    return { ok: false, error: 'Error inesperado. Intenta de nuevo.', code: 'UNKNOWN' }
  }
}

export interface AdminState {
  settings: EmailSettingsDTO
  smtp: ReturnType<typeof smtpStatus>
  chat: { configured: boolean; host: string | null }
  webhook: { configured: boolean }
  modes: { id: DeliveryMode; label: string }[]
  limits: { maxTestRecipients: number; testDomains: string[] }
  appUrl: string
}

/** Todo lo que necesita la pantalla de configuración. Nunca incluye contraseñas ni URLs con llaves. */
export async function getAdminState(): Promise<AdminState> {
  const [settings, webhook] = await Promise.all([getSettings(), findWebhookButton()])
  let chatHost: string | null = null
  try {
    if (process.env.PMKT_CHAT_WEBHOOK_URL) chatHost = new URL(process.env.PMKT_CHAT_WEBHOOK_URL).hostname
  } catch {
    chatHost = 'URL inválida'
  }
  return {
    settings,
    smtp: smtpStatus(),
    chat: { configured: Boolean(process.env.PMKT_CHAT_WEBHOOK_URL?.trim()), host: chatHost },
    webhook: { configured: webhook !== null },
    modes: DELIVERY_MODES.map((id) => ({ id, label: MODE_LABELS[id] })),
    limits: { maxTestRecipients: MAX_TEST_RECIPIENTS, testDomains: allowedTestDomains() },
    appUrl: publicAppUrl(),
  }
}

export function saveSettings(actor: SettingsActor, patch: SettingsPatch) {
  return run(() => updateSettings(actor, patch))
}

export function verifyConnection() {
  return run(async () => {
    const r = await verifySmtp()
    return r.ok ? { ok: true as const } : { ok: false as const, code: r.error.code, message: r.error.message, detail: r.error.detail }
  })
}

// ---------------- plantilla ----------------

export interface TemplateState {
  template: TemplateDTO
  revisions: RevisionDTO[]
  variables: typeof VARIABLE_DOCS
  defaults: { subject: string; html: string }
}

export async function getTemplateState(): Promise<TemplateState> {
  const [template, revisions] = await Promise.all([getActiveTemplate(), listRevisions()])
  return { template, revisions, variables: VARIABLE_DOCS, defaults: { subject: DEFAULT_SUBJECT, html: DEFAULT_HTML } }
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export interface PreviewResult {
  subject: string
  html: string
  text: string
  source: 'sample' | 'record'
  recordTitle?: string
}

/** Renderiza un borrador (sin guardarlo) con datos de ejemplo o con una novedad real. */
export function previewTemplate(input: { subject: unknown; html: unknown; recordId?: unknown }) {
  return run<PreviewResult>(async () => {
    if (typeof input.subject !== 'string' || typeof input.html !== 'string') {
      throw new EmailSendError({ code: 'VALIDATION', message: 'Asunto y cuerpo deben ser texto.' })
    }
    let vars = sampleVariables()
    let source: PreviewResult['source'] = 'sample'
    let recordTitle: string | undefined
    if (typeof input.recordId === 'string' && input.recordId) {
      if (!ID_RE.test(input.recordId)) throw new EmailSendError({ code: 'NOT_FOUND', message: 'Registro no encontrado.' })
      const rec = await prisma.record.findUnique({ where: { id: input.recordId } })
      if (!rec) throw new EmailSendError({ code: 'NOT_FOUND', message: 'Registro no encontrado.' })
      const logical = mapRecordData(rec.data as Record<string, unknown>, await loadFieldMap())
      vars = buildVariables(logical, rec.id)
      source = 'record'
      recordTitle = vars.titulo
    }
    const r = renderEmail({ subject: input.subject.trim(), html: input.html }, vars)
    return { ...r, source, recordTitle }
  })
}

export function saveTemplateRun(actor: SettingsActor, input: { subject: unknown; html: unknown }) {
  return run(() => saveTemplate(actor, input))
}

export function restoreDefaultRun(actor: SettingsActor) {
  return run(() => restoreDefault(actor))
}

export function restoreRevisionRun(actor: SettingsActor, version: unknown) {
  return run(() => restoreRevision(actor, Number(version)))
}

export function getRevisionRun(version: unknown) {
  return run(() => getRevision(Number(version)))
}

export interface NovedadOption {
  id: string
  titulo: string
  tipo: string
  createdAt: string
}

/** Últimas Novedades / Pre-novedades, para elegir con qué datos reales previsualizar, probar o simular. */
export async function listRecentNovedades(limit = 25): Promise<NovedadOption[]> {
  const [map, rows] = await Promise.all([loadFieldMap(), prisma.record.findMany({ orderBy: { createdAt: 'desc' }, take: 300 })])
  const out: NovedadOption[] = []
  for (const r of rows) {
    const logical = mapRecordData(r.data as Record<string, unknown>, map)
    const tipo = String(logical.tipo ?? '')
    if (!['novedad', 'pre-novedad', 'pre novedad'].includes(tipo.toLowerCase().trim())) continue
    out.push({ id: r.id, titulo: String(logical.titulo ?? '(sin título)').slice(0, 120), tipo, createdAt: r.createdAt.toISOString() })
    if (out.length >= limit) break
  }
  return out
}

