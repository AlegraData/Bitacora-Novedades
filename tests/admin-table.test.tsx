import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString as render } from 'react-dom/server'
import { PAGE_SIZES, clampPageSize, matchesQuery, normalizeText, paginate, pageWindow } from '@/lib/admin/table'
import { DataTable, Pagination, StatCard, BarList, DayBars } from '@/components/admin/ui'

const html = (el: Parameters<typeof render>[0]) => render(el).replace(/<!-- -->/g, '')

test('tamaños de página permitidos: 10, 20 y 50; cualquier otro valor vuelve a 10', () => {
  assert.deepEqual([...PAGE_SIZES], [10, 20, 50])
  for (const ok of [10, 20, 50, '20']) assert.equal(clampPageSize(ok), Number(ok))
  for (const bad of [0, 5, 15, 100, -1, 'x', null, undefined, NaN]) assert.equal(clampPageSize(bad), 10, String(bad))
})

test('búsqueda: sin tildes ni mayúsculas, todas las palabras deben aparecer', () => {
  assert.equal(normalizeText('  Tomás LOPERA '), 'tomas lopera')
  assert.equal(matchesQuery(['Tomás Lopera', 'tomas.lopera@alegra.com'], 'tomas'), true)
  assert.equal(matchesQuery(['Tomás Lopera', 'VIEWER'], 'tomas viewer'), true)
  assert.equal(matchesQuery(['Tomás Lopera', 'VIEWER'], 'tomas admin'), false)
  assert.equal(matchesQuery(['x'], '   '), true, 'búsqueda vacía = todo')
  assert.equal(matchesQuery([null, undefined, 5], '5'), true)
})

test('paginate: recorta, calcula rangos y ajusta páginas fuera de rango', () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1)
  const p1 = paginate(items, 1, 10)
  assert.deepEqual([p1.rows.length, p1.page, p1.pageCount, p1.total, p1.from, p1.to], [10, 1, 3, 25, 1, 10])
  const p3 = paginate(items, 3, 10)
  assert.deepEqual([p3.rows, p3.from, p3.to], [[21, 22, 23, 24, 25], 21, 25])
  assert.equal(paginate(items, 99, 10).page, 3, 'página inexistente → la última')
  assert.equal(paginate(items, 0, 10).page, 1)
  assert.equal(paginate(items, 1, 20).pageCount, 2)
  assert.equal(paginate(items, 1, 50).pageCount, 1)
  const empty = paginate([], 1, 10)
  assert.deepEqual([empty.rows.length, empty.page, empty.pageCount, empty.from, empty.to], [0, 1, 1, 0, 0])
})

test('pageWindow: primera, última y vecinas, con puntos suspensivos', () => {
  assert.deepEqual(pageWindow(1, 1), [1])
  assert.deepEqual(pageWindow(2, 3), [1, 2, 3])
  assert.deepEqual(pageWindow(1, 20), [1, 2, '…', 20])
  assert.deepEqual(pageWindow(10, 20), [1, '…', 9, 10, 11, '…', 20])
  assert.deepEqual(pageWindow(20, 20), [1, '…', 19, 20])
})

type Row = { id: string; name: string }
const rows: Row[] = Array.from({ length: 25 }, (_, i) => ({ id: `r${i + 1}`, name: `Persona ${i + 1}` }))
const columns = [{ key: 'name', header: 'Nombre', render: (r: Row) => r.name }]

test('DataTable: muestra 10 filas, el rango «1–10 de 25», el buscador y el selector 10/20/50', () => {
  const h = html(<DataTable columns={columns} rows={rows} getKey={(r) => r.id} searchText={(r) => [r.name]} searchPlaceholder="Buscar persona" />)
  assert.ok(h.includes('Persona 10') && !h.includes('Persona 11'))
  assert.ok(h.includes('1–10 de 25'))
  assert.ok(h.includes('aria-label="Buscar persona"'))
  for (const s of PAGE_SIZES) assert.ok(h.includes(`<option value="${s}"`), `opción ${s}`)
  assert.ok(h.includes('aria-label="Filas por página"'))
})

test('DataTable: tamaño inicial 20 y estado vacío', () => {
  const h = html(<DataTable columns={columns} rows={rows} getKey={(r) => r.id} initialPageSize={20} />)
  assert.ok(h.includes('Persona 20') && !h.includes('Persona 21') && h.includes('1–20 de 25'))
  const e = html(<DataTable columns={columns} rows={[]} getKey={(r: Row) => r.id} empty="No hay usuarios." />)
  assert.ok(e.includes('No hay usuarios.') && e.includes('Sin resultados'))
})

test('Pagination: deshabilita «anterior» en la primera página y marca la actual', () => {
  const h = html(<Pagination page={1} pageCount={3} total={25} from={1} to={10} pageSize={10} onPage={() => {}} onPageSize={() => {}} />)
  assert.ok(/aria-label="Página anterior"[^>]*disabled|disabled[^>]*aria-label="Página anterior"/.test(h))
  assert.ok(h.includes('aria-current="page"'))
})

test('tarjetas y gráficos: valores visibles y estados vacíos', () => {
  assert.ok(html(<StatCard label="Llamadas (7 d)" value={815} />).includes('815'))
  assert.ok(html(<BarList items={[{ label: 'Claude', value: 18 }, { label: 'opencode', value: 5 }]} />).includes('Claude'))
  assert.ok(html(<BarList items={[]} />).includes('Sin datos'))
  assert.ok(html(<DayBars days={[{ label: '4/11', value: 3 }, { label: '5/11', value: 0 }]} />).includes('Llamadas por día'))
  assert.ok(html(<DayBars days={[{ label: '4/11', value: 0 }]} />).includes('Sin llamadas'))
})
