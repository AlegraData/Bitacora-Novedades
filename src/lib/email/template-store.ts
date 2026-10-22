import { prisma } from '@/lib/prisma'
import { addAuditLog } from '@/lib/actions/audit'
import { DEFAULT_HTML, DEFAULT_SUBJECT, TEMPLATE_KEY } from './default-template'
import { validateTemplate, TemplateError } from './render'
import { EmailSendError } from './errors'
import type { SettingsActor } from './settings'

export interface TemplateDTO {
  subject: string
  html: string
  version: number
  /** true si nadie la ha editado: se usa la plantilla que viene con la app. */
  isDefault: boolean
  updatedAt: string | null
  updatedByEmail: string | null
}

export async function getActiveTemplate(): Promise<TemplateDTO> {
  const t = await prisma.emailTemplate.findUnique({ where: { key: TEMPLATE_KEY } })
  if (!t) return { subject: DEFAULT_SUBJECT, html: DEFAULT_HTML, version: 0, isDefault: true, updatedAt: null, updatedByEmail: null }
  return { subject: t.subject, html: t.html, version: t.version, isDefault: false, updatedAt: t.updatedAt.toISOString(), updatedByEmail: t.updatedByEmail }
}

function check(subject: string, html: string) {
  try {
    validateTemplate(subject, 'plantilla del asunto')
    validateTemplate(html, 'plantilla del cuerpo')
  } catch (e) {
    if (e instanceof TemplateError) throw new EmailSendError({ code: 'TEMPLATE', message: e.message })
    throw e
  }
}

/** Guarda una versión nueva y deja la anterior en el historial (nunca se pierde una plantilla). */
export async function saveTemplate(actor: SettingsActor, input: { subject: unknown; html: unknown }, why = 'TEMPLATE_UPDATED'): Promise<TemplateDTO> {
  if (typeof input.subject !== 'string' || typeof input.html !== 'string') {
    throw new EmailSendError({ code: 'VALIDATION', message: 'Asunto y cuerpo deben ser texto.' })
  }
  const subject = input.subject.trim()
  check(subject, input.html)

  const version = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('email-template'))`
    const existing = await tx.emailTemplate.findUnique({ where: { key: TEMPLATE_KEY } })
    if (!existing) {
      // Primera edición: se archiva también la plantilla por defecto como versión 1 para poder volver a ella.
      await tx.emailTemplateRevision.create({ data: { templateKey: TEMPLATE_KEY, version: 1, subject: DEFAULT_SUBJECT, html: DEFAULT_HTML, savedByEmail: null } })
    }
    const next = (existing?.version ?? 1) + 1
    await tx.emailTemplate.upsert({
      where: { key: TEMPLATE_KEY },
      update: { subject, html: input.html as string, version: next, updatedByEmail: actor.email },
      create: { key: TEMPLATE_KEY, subject, html: input.html as string, version: next, updatedByEmail: actor.email },
    })
    await tx.emailTemplateRevision.create({ data: { templateKey: TEMPLATE_KEY, version: next, subject, html: input.html as string, savedByEmail: actor.email } })
    return next
  })

  await addAuditLog({
    userId: actor.id, userEmail: actor.email, userName: actor.name ?? actor.email,
    action: `EMAIL_${why}`, details: { version },
  })
  return getActiveTemplate()
}

export async function restoreDefault(actor: SettingsActor): Promise<TemplateDTO> {
  return saveTemplate(actor, { subject: DEFAULT_SUBJECT, html: DEFAULT_HTML }, 'TEMPLATE_RESTORED_DEFAULT')
}

export interface RevisionDTO {
  version: number
  savedByEmail: string | null
  createdAt: string
  isActive: boolean
}

export async function listRevisions(limit = 30): Promise<RevisionDTO[]> {
  const [rows, active] = await Promise.all([
    prisma.emailTemplateRevision.findMany({ where: { templateKey: TEMPLATE_KEY }, orderBy: { version: 'desc' }, take: Math.min(limit, 100) }),
    getActiveTemplate(),
  ])
  return rows.map((r) => ({ version: r.version, savedByEmail: r.savedByEmail, createdAt: r.createdAt.toISOString(), isActive: r.version === active.version }))
}

export async function getRevision(version: number) {
  const r = await prisma.emailTemplateRevision.findFirst({ where: { templateKey: TEMPLATE_KEY, version } })
  if (!r) throw new EmailSendError({ code: 'NOT_FOUND', message: 'Esa versión de la plantilla no existe.' })
  return { subject: r.subject, html: r.html, version: r.version }
}

/** Restaurar crea una versión nueva con el contenido viejo (el historial solo crece). */
export async function restoreRevision(actor: SettingsActor, version: number): Promise<TemplateDTO> {
  const r = await getRevision(version)
  return saveTemplate(actor, { subject: r.subject, html: r.html }, 'TEMPLATE_RESTORED')
}
