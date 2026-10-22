// Variables que ve la plantilla. Todo lo que viene del registro se normaliza
// aquí: lo vacío / "N/A" desaparece (undefined) y las URLs solo pueden ser http(s).

export interface EmailVariables {
  tipo?: string
  titulo?: string
  descripcion?: string
  fecha?: string
  elaborado?: string
  responsables?: string
  versiones?: string
  producto?: string
  sh?: string
  documentacion?: string
  video?: string
  url: string
  recordId: string
}

// Mismos valores que el webhook legado trataba como "vacío".
const EMPTY_VALUES = new Set(['n/a', 'na', 'no aplica', 'ninguno'])

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

function one(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v !== 'string' && typeof v !== 'number') return undefined
  const s = String(v).replace(CONTROL_CHARS, '').trim()
  if (!s || EMPTY_VALUES.has(s.toLowerCase())) return undefined
  return s
}

function text(v: unknown): string | undefined {
  if (Array.isArray(v)) {
    const parts = v.map(one).filter((x): x is string => !!x)
    return parts.length ? parts.join(', ') : undefined
  }
  return one(v)
}

/** Solo http/https. Evita javascript:, data:, etc. en los href del correo. */
export function safeUrl(v: unknown): string | undefined {
  const s = one(v)
  if (!s) return undefined
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}

export function publicAppUrl(): string {
  return (process.env.APP_PUBLIC_URL || 'https://bitacora-novedades.alegra.com').replace(/\/+$/, '')
}

export function recordUrl(recordId: string): string {
  return `${publicAppUrl()}/app?record=${encodeURIComponent(recordId)}`
}

/** `logical` es el resultado de mapRecordData (claves lógicas del MCP). */
export function buildVariables(logical: Record<string, unknown>, recordId: string): EmailVariables {
  const elaborado = Array.isArray(logical.elaborado) ? one(logical.elaborado[0]) : one(logical.elaborado)
  return {
    recordId,
    url: recordUrl(recordId),
    tipo: text(logical.tipo),
    titulo: text(logical.titulo),
    descripcion: text(logical.breveDescripcion),
    fecha: text(logical.fechaLanzamiento),
    elaborado,
    responsables: text(logical.responsables),
    versiones: text(logical.version),
    producto: text(logical.producto),
    sh: text(logical.sh),
    documentacion: safeUrl(logical.documentacionOnePager),
    video: safeUrl(logical.video),
  }
}

/** Datos de ejemplo para la vista previa y los correos de prueba del admin. */
export function sampleVariables(): EmailVariables {
  return {
    recordId: 'ejemplo',
    url: recordUrl('ejemplo'),
    tipo: 'Novedad',
    titulo: 'Conciliación bancaria automática',
    descripcion: 'Ahora puedes conciliar tus movimientos bancarios de forma automática, ahorrando tiempo en el cierre contable.',
    fecha: '2026-11-15',
    elaborado: 'ejemplo@alegra.com',
    responsables: 'ana@alegra.com, luis@alegra.com',
    versiones: 'v3.2.0',
    producto: 'Alegra Contabilidad',
    sh: 'Contabilidad',
    documentacion: 'https://wiki.alegra.com/doc/ejemplo',
    video: 'https://www.youtube.com/watch?v=ejemplo',
  }
}

export const VARIABLE_DOCS: { name: string; description: string; optional: boolean }[] = [
  { name: 'titulo', description: 'Título de la novedad', optional: false },
  { name: 'tipo', description: 'Tipo (Novedad, Pre-novedad…)', optional: true },
  { name: 'producto', description: 'Producto(s), separados por coma', optional: true },
  { name: 'descripcion', description: 'Breve descripción', optional: true },
  { name: 'fecha', description: 'Fecha de lanzamiento', optional: true },
  { name: 'versiones', description: 'Versión(es)', optional: true },
  { name: 'sh', description: 'SH encargado', optional: true },
  { name: 'responsables', description: 'Responsables, separados por coma', optional: true },
  { name: 'elaborado', description: 'Autor (email)', optional: true },
  { name: 'documentacion', description: 'Link a la documentación (solo http/https)', optional: true },
  { name: 'video', description: 'Link a video/ayuda (solo http/https)', optional: true },
  { name: 'url', description: 'Link al registro en la Bitácora', optional: false },
]
