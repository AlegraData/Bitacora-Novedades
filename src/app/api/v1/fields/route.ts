import { loadFieldMap } from '@/lib/mcp/fields'
import { apiRoute, apiJson } from '@/lib/api/http'

/** Esquema de campos: nombres lógicos que acepta/devuelve la API, su tipo y opciones válidas. */
export const GET = apiRoute('records:read', async () => {
  const map = await loadFieldMap()
  const fields = [...map.entries()].map(([key, info]) => ({
    key,
    name: info.name,
    type: info.type,
    options: info.options,
  }))
  return apiJson({ fields })
})
