import Handlebars from 'handlebars'
import type { EmailVariables } from './variables'

export class TemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateError'
  }
}

export const MAX_TEMPLATE_CHARS = 200_000
const MAX_RENDERED_CHARS = 500_000
const MAX_SUBJECT_CHARS = 200

// Entorno aislado: no comparte helpers con nada más y se le quita el que escribe en consola.
const hb = Handlebars.create()
hb.unregisterHelper('log')

type AstNode = { type?: string; escaped?: boolean; loc?: { start: { line: number } }; [k: string]: unknown }

function walk(node: unknown, visit: (n: AstNode) => void) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit))
  if (node && typeof node === 'object') {
    const n = node as AstNode
    if (typeof n.type === 'string') visit(n)
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v, visit)
  }
}

/**
 * La plantilla la edita un ADMIN, pero igual se restringe a lo seguro:
 * - nada de {{{triple}}} ni {{&x}} (HTML sin escapar de datos del registro);
 * - nada de parciales ni decoradores;
 * - tamaño acotado.
 */
export function validateTemplate(source: string, label = 'plantilla'): void {
  if (typeof source !== 'string' || !source.trim()) throw new TemplateError(`La ${label} está vacía.`)
  if (source.length > MAX_TEMPLATE_CHARS) {
    throw new TemplateError(`La ${label} supera ${MAX_TEMPLATE_CHARS.toLocaleString('es-CO')} caracteres.`)
  }
  let ast: unknown
  try {
    ast = hb.parse(source)
  } catch (e) {
    throw new TemplateError(`Error de sintaxis en la ${label}: ${(e as Error).message.split('\n')[0]}`)
  }
  walk(ast, (n) => {
    const line = n.loc?.start.line ? ` (línea ${n.loc.start.line})` : ''
    if (n.type === 'MustacheStatement' && n.escaped === false) {
      throw new TemplateError(`No se permite HTML sin escapar ({{{ }}} o {{& }})${line}. Usa {{variable}}.`)
    }
    if (n.type === 'PartialStatement' || n.type === 'PartialBlockStatement') {
      throw new TemplateError(`No se permiten parciales${line}.`)
    }
    if (n.type === 'Decorator' || n.type === 'DecoratorBlock') {
      throw new TemplateError(`No se permiten decoradores${line}.`)
    }
  })
}

const RUNTIME = { allowProtoPropertiesByDefault: false, allowProtoMethodsByDefault: false }

function run(source: string, vars: EmailVariables, escape: boolean): string {
  let out: string
  try {
    out = hb.compile(source, { noEscape: !escape, strict: false })({ ...vars }, RUNTIME)
  } catch (e) {
    throw new TemplateError(`No se pudo renderizar: ${(e as Error).message.split('\n')[0]}`)
  }
  if (out.length > MAX_RENDERED_CHARS) throw new TemplateError('El correo generado es demasiado grande.')
  return out
}

const LINE_BREAKS = new RegExp('[\\r\\n' + String.fromCharCode(0x2028, 0x2029) + ']+', 'g')

/** El asunto va en una sola línea: cualquier salto se aplana (evita inyección de cabeceras). */
export function renderSubject(source: string, vars: EmailVariables): string {
  validateTemplate(source, 'plantilla del asunto')
  const subject = run(source, vars, false).replace(LINE_BREAKS, ' ').replace(/\s{2,}/g, ' ').trim()
  return subject.slice(0, MAX_SUBJECT_CHARS)
}

const NAMED: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_m, n: string) => NAMED[n])
}

/** Versión en texto plano (mejora la entregabilidad y sirve a clientes sin HTML). */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const t = label.replace(/<[^>]+>/g, '').trim()
      const url = decodeEntities(href)
      return t && t !== url ? `${t} (${url})` : url
    })
    .replace(/<(br|\/p|\/li|\/tr|\/h[1-6]|\/div|\/ul)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(stripped)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function renderEmail(template: { subject: string; html: string }, vars: EmailVariables): RenderedEmail {
  validateTemplate(template.html, 'plantilla del cuerpo')
  const html = run(template.html, vars, true)
  return { subject: renderSubject(template.subject, vars), html, text: htmlToText(html) }
}
