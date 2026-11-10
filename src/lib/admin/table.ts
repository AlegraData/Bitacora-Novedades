// Helpers puros de las tablas del panel de administración (sin dependencias de servidor ni de React).

export const PAGE_SIZES = [10, 20, 50] as const
export type PageSize = (typeof PAGE_SIZES)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 10

/** Cualquier valor → un tamaño de página permitido (10, 20 o 50). */
export function clampPageSize(n: unknown): PageSize {
  const v = Number(n)
  return (PAGE_SIZES as readonly number[]).includes(v) ? (v as PageSize) : DEFAULT_PAGE_SIZE
}

/** Minúsculas y sin tildes, para buscar «tomas» y encontrar «Tomás». */
export function normalizeText(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** ¿La fila coincide con la búsqueda? Todas las palabras escritas deben aparecer en alguno de sus textos. */
export function matchesQuery(haystack: unknown[], query: string): boolean {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = haystack.map(normalizeText).join(' ')
  return words.every((w) => text.includes(w))
}

export interface Page<T> {
  rows: T[]
  /** Página efectiva (1-based), ya ajustada al rango válido. */
  page: number
  pageCount: number
  total: number
  /** Posición (1-based) del primer y último elemento mostrado; 0 si no hay filas. */
  from: number
  to: number
  pageSize: PageSize
}

/** Recorta una lista a una página. Si la página pedida ya no existe (por ejemplo tras filtrar), usa la última. */
export function paginate<T>(items: T[], page: number, pageSize: unknown): Page<T> {
  const size = clampPageSize(pageSize)
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / size))
  const current = Math.min(Math.max(1, Math.floor(Number(page)) || 1), pageCount)
  const start = (current - 1) * size
  const rows = items.slice(start, start + size)
  return { rows, page: current, pageCount, total, from: rows.length ? start + 1 : 0, to: start + rows.length, pageSize: size }
}

/** Números de página a mostrar con puntos suspensivos: 1 … 4 5 6 … 20. */
export function pageWindow(page: number, pageCount: number, radius = 1): (number | '…')[] {
  const pages = new Set<number>([1, pageCount])
  for (let p = page - radius; p <= page + radius; p++) if (p >= 1 && p <= pageCount) pages.add(p)
  const sorted = [...pages].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('…')
    out.push(p)
  })
  return out
}
