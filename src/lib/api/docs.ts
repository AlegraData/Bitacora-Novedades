import { API_BASE_URL, SCOPES, type Scope } from './constants'

// Sin imports de servidor: lo usan la página de documentación (cliente/servidor) y el generador de OpenAPI.

export interface Param {
  name: string
  in: 'query' | 'path' | 'body'
  type: 'string' | 'integer' | 'boolean' | 'string[]' | 'object'
  required?: boolean
  description: string
}

export interface Endpoint {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  scope: Scope | null
  summary: string
  /** Equivalente en el MCP, para quien ya lo conoce. */
  mcpTool?: string
  params: Param[]
  example: string
}

const listParams: Param[] = [
  { name: 'tipo', in: 'query', type: 'string', description: 'Tipo de novedad (ej. Novedad, Pre-novedad, Mejora). Ver GET /fields para las opciones.' },
  { name: 'status', in: 'query', type: 'string', description: 'Estado del registro.' },
  { name: 'producto', in: 'query', type: 'string[]', description: 'Uno o varios productos (repite el parámetro o sepáralos por coma).' },
  { name: 'sh', in: 'query', type: 'string', description: 'SH asociado.' },
  { name: 'elaborado', in: 'query', type: 'string', description: 'Email del autor.' },
  { name: 'responsables', in: 'query', type: 'string[]', description: 'Uno o varios emails de responsables.' },
  { name: 'proyectoLinear', in: 'query', type: 'string', description: 'Texto contenido en el link/ID de Linear (sin distinguir mayúsculas). Ideal para cruzar una mejora con su novedad.' },
  { name: 'fechaLanzamientoDesde', in: 'query', type: 'string', description: 'YYYY-MM-DD.' },
  { name: 'fechaLanzamientoHasta', in: 'query', type: 'string', description: 'YYYY-MM-DD.' },
  { name: 'fechaProduccionDesde', in: 'query', type: 'string', description: 'YYYY-MM-DD. Fecha REAL de salida a producción; excluye novedades sin esa fecha.' },
  { name: 'fechaProduccionHasta', in: 'query', type: 'string', description: 'YYYY-MM-DD.' },
  { name: 'query', in: 'query', type: 'string', description: 'Texto libre en cualquier campo.' },
  { name: 'fields', in: 'query', type: 'string[]', description: 'Devuelve solo estos campos (además de id). Ej. fields=titulo,fechaProduccion.' },
  { name: 'limit', in: 'query', type: 'integer', description: 'Registros por página. Default 50, máximo 200.' },
  { name: 'offset', in: 'query', type: 'integer', description: 'Para paginar. Default 0.' },
]

const idParam: Param = { name: 'id', in: 'path', type: 'string', required: true, description: 'ID interno de la novedad.' }
const recordBody: Param = {
  name: '(body JSON)',
  in: 'body',
  type: 'object',
  description:
    'Campos por su nombre lógico (titulo, tipo, fechaLanzamiento, elaborado, breveDescripcion, producto, responsables, proyectoLinear, fechaProduccion…). La lista completa y las opciones válidas están en GET /fields.',
}

export const ENDPOINTS: Endpoint[] = [
  {
    method: 'GET', path: '/me', scope: null, summary: 'Identidad y permisos del token que hace la llamada. Útil para probar la conexión.',
    params: [], example: `curl -H "Authorization: Bearer $TOKEN" ${API_BASE_URL}/me`,
  },
  {
    method: 'GET', path: '/fields', scope: 'records:read', summary: 'Esquema de campos: nombre lógico, tipo y opciones válidas.',
    params: [], example: `curl -H "Authorization: Bearer $TOKEN" ${API_BASE_URL}/fields`,
  },
  {
    method: 'GET', path: '/records', scope: 'records:read', summary: 'Lista novedades con filtros y paginación.', mcpTool: 'list_records',
    params: listParams,
    example: `curl -G -H "Authorization: Bearer $TOKEN" \\\n  --data-urlencode "proyectoLinear=REVPYME-711" \\\n  --data-urlencode "fields=titulo,fechaProduccion,status" \\\n  ${API_BASE_URL}/records`,
  },
  {
    method: 'GET', path: '/records/search', scope: 'records:read', summary: 'Búsqueda semántica en lenguaje natural (embeddings).', mcpTool: 'search_records_semantic',
    params: [
      { name: 'q', in: 'query', type: 'string', required: true, description: 'Consulta en lenguaje natural (máx. 500 caracteres).' },
      { name: 'limit', in: 'query', type: 'integer', description: 'Default 10, máximo 50.' },
      { name: 'producto', in: 'query', type: 'string', description: 'Filtra por producto.' },
      { name: 'fechaLanzamientoDesde', in: 'query', type: 'string', description: 'YYYY-MM-DD.' },
      { name: 'fechaLanzamientoHasta', in: 'query', type: 'string', description: 'YYYY-MM-DD.' },
      { name: 'fields', in: 'query', type: 'string[]', description: 'Proyección de campos.' },
    ],
    example: `curl -G -H "Authorization: Bearer $TOKEN" \\\n  --data-urlencode "q=facturación electrónica para restaurantes" \\\n  ${API_BASE_URL}/records/search`,
  },
  {
    method: 'GET', path: '/records/{id}', scope: 'records:read', summary: 'Detalle completo de una novedad.', mcpTool: 'get_record',
    params: [idParam, { name: 'fields', in: 'query', type: 'string[]', description: 'Proyección de campos.' }],
    example: `curl -H "Authorization: Bearer $TOKEN" ${API_BASE_URL}/records/<id>`,
  },
  {
    method: 'POST', path: '/records', scope: 'records:write', summary: 'Crea una novedad (a nombre del dueño del token). Obligatorios: tipo, titulo, fechaLanzamiento, elaborado.', mcpTool: 'create_record',
    params: [recordBody],
    example: `curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\\n  -d '{"tipo":"Novedad","titulo":"Nueva conciliación","fechaLanzamiento":"2026-11-01","elaborado":"tu@alegra.com"}' \\\n  ${API_BASE_URL}/records`,
  },
  {
    method: 'PATCH', path: '/records/{id}', scope: 'records:write', summary: 'Actualiza solo los campos enviados. Solo su autor o un ADMIN. Las listas se combinan salvo replaceArrays:true.', mcpTool: 'update_record',
    params: [idParam, recordBody, { name: 'replaceArrays', in: 'body', type: 'boolean', description: 'true = las listas enviadas reemplazan las existentes.' }],
    example: `curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\\n  -d '{"fechaProduccion":"2026-11-05"}' \\\n  ${API_BASE_URL}/records/<id>`,
  },
  {
    method: 'DELETE', path: '/records/{id}', scope: 'records:delete', summary: 'Elimina una novedad. Irreversible; exige scope records:delete y que el dueño del token sea ADMIN.', mcpTool: 'delete_record',
    params: [idParam], example: `curl -X DELETE -H "Authorization: Bearer $TOKEN" ${API_BASE_URL}/records/<id>`,
  },
  {
    method: 'POST', path: '/records/{id}/notify-pmkt', scope: 'pmkt:notify', summary: 'Fallback manual de la comunicación por correo. Sin confirm:true solo simula (devuelve el correo exacto, no envía). La respuesta trae status (sent | simulated | failed | skipped) y, si falló, error.code con el motivo; el estado HTTP depende del código (409 duplicado, 422 faltan datos, 502 fallo del servidor de correo, 503 sin configurar).', mcpTool: 'notify_pmkt',
    params: [idParam, { name: 'confirm', in: 'body', type: 'boolean', description: 'true para enviar de verdad.' }, { name: 'resend', in: 'body', type: 'boolean', description: 'Reenviar algo ya comunicado (requiere reason).' }, { name: 'reason', in: 'body', type: 'string', description: 'Motivo del reenvío, de 10 a 500 caracteres (queda en el historial).' }],
    example: `curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\\n  -d '{"confirm":false}' ${API_BASE_URL}/records/<id>/notify-pmkt`,
  },
  {
    method: 'GET', path: '/records/{id}/email-deliveries', scope: 'records:read', summary: 'Historial de envíos de correo de una novedad: quién, cuándo, por qué canal, a quién, con qué resultado y el motivo si falló.', mcpTool: 'list_email_deliveries',
    params: [idParam, { name: 'status', in: 'query', type: 'string', description: 'sending | sent | failed | simulated.' }, { name: 'mode', in: 'query', type: 'string', description: 'webhook | shadow | test | live | simulate | legacy.' }, { name: 'limit', in: 'query', type: 'integer', description: 'Default 50, máximo 200.' }, { name: 'offset', in: 'query', type: 'integer', description: 'Para paginar.' }],
    example: `curl -H "Authorization: Bearer $TOKEN" ${API_BASE_URL}/records/<id>/email-deliveries`,
  },
  {
    method: 'GET', path: '/email-deliveries', scope: 'audit:read', summary: 'Historial de envíos de correo de toda la Bitácora, con los mismos filtros más recordId.', mcpTool: 'list_email_deliveries',
    params: [{ name: 'recordId', in: 'query', type: 'string', description: 'Filtra por novedad.' }, { name: 'status', in: 'query', type: 'string', description: 'sending | sent | failed | simulated.' }, { name: 'mode', in: 'query', type: 'string', description: 'webhook | shadow | test | live | simulate | legacy.' }, { name: 'limit', in: 'query', type: 'integer', description: 'Default 50, máximo 200.' }, { name: 'offset', in: 'query', type: 'integer', description: 'Para paginar.' }],
    example: `curl -G -H "Authorization: Bearer $TOKEN" --data-urlencode "status=failed" ${API_BASE_URL}/email-deliveries`,
  },
  {
    method: 'GET', path: '/audit-log', scope: 'audit:read', summary: 'Historial de cambios y accesos.', mcpTool: 'list_audit_log',
    params: [
      { name: 'recordId', in: 'query', type: 'string', description: 'Filtra por registro.' },
      { name: 'userId', in: 'query', type: 'string', description: 'Filtra por usuario.' },
      { name: 'desde', in: 'query', type: 'string', description: 'YYYY-MM-DD.' },
      { name: 'hasta', in: 'query', type: 'string', description: 'YYYY-MM-DD.' },
      { name: 'limit', in: 'query', type: 'integer', description: 'Default 50, máximo 200.' },
    ],
    example: `curl -H "Authorization: Bearer $TOKEN" "${API_BASE_URL}/audit-log?recordId=<id>"`,
  },
]

export const ERRORS: { status: number; code: string; meaning: string }[] = [
  { status: 400, code: 'invalid_request / invalid_json', meaning: 'Parámetro o body inválido. El mensaje indica cuál; en validaciones de campos viene error.details.' },
  { status: 401, code: 'missing_token / invalid_token / token_expired', meaning: 'Falta el header, el token no existe o fue revocado, o expiró.' },
  { status: 403, code: 'insufficient_scope / forbidden', meaning: 'El token no tiene el scope, o el rol de su dueño no permite la acción (ej. editar algo que creó otra persona).' },
  { status: 404, code: 'not_found', meaning: 'El registro no existe.' },
  { status: 413 , code: 'payload_too_large', meaning: 'El body supera 1 MB.' },
  { status: 415, code: 'unsupported_media_type', meaning: 'Los POST/PATCH requieren Content-Type: application/json.' },
  { status: 429, code: 'rate_limited / too_many_attempts', meaning: 'Demasiados requests (120/min por token) o demasiados intentos con tokens inválidos. Respeta Retry-After.' },
  { status: 500, code: 'internal_error', meaning: 'Error del servidor. Reintenta; si persiste, avisa al equipo de Data.' },
]

export const SNIPPETS = {
  curl: `export TOKEN="btk_..."   # tu token\ncurl -H "Authorization: Bearer $TOKEN" ${API_BASE_URL}/me`,
  appsScript: `// 1) Guarda el token en Propiedades del script (Configuración del proyecto → Propiedades del script)\n//    BITACORA_TOKEN = btk_...   (nunca lo pegues en el código)\nconst BASE = '${API_BASE_URL}';\n\nfunction bitacora_(path, params) {\n  const qs = Object.keys(params || {})\n    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');\n  const res = UrlFetchApp.fetch(BASE + path + (qs ? '?' + qs : ''), {\n    headers: { Authorization: 'Bearer ' + PropertiesService.getScriptProperties().getProperty('BITACORA_TOKEN') },\n    muteHttpExceptions: true,\n  });\n  if (res.getResponseCode() !== 200) throw new Error(res.getResponseCode() + ' ' + res.getContentText());\n  return JSON.parse(res.getContentText());\n}\n\n// 2) ¿La mejora ya salió al mercado? Cruza por el issue/proyecto de Linear.\nfunction yaSalio(linearId) {\n  const { records } = bitacora_('/records', {\n    proyectoLinear: linearId,\n    fields: 'titulo,fechaProduccion,status',\n    fechaProduccionDesde: '2000-01-01', // solo las que ya tienen fecha real de producción\n  });\n  return records.length > 0 ? records[0] : null;\n}`,
  node: `const res = await fetch('${API_BASE_URL}/records?tipo=Novedad&limit=20', {\n  headers: { Authorization: \`Bearer \${process.env.BITACORA_TOKEN}\` },\n});\nif (!res.ok) throw new Error(\`\${res.status} \${await res.text()}\`);\nconst { total, records } = await res.json();`,
  python: `import os, requests\n\nr = requests.get(\n    "${API_BASE_URL}/records",\n    headers={"Authorization": f"Bearer {os.environ['BITACORA_TOKEN']}"},\n    params={"proyectoLinear": "REVPYME-711", "fields": "titulo,fechaProduccion"},\n    timeout=30,\n)\nr.raise_for_status()\nprint(r.json()["records"])`,
}

/** Genera la especificación OpenAPI 3.0 a partir del catálogo. */
export function buildOpenApi(origin?: string) {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const e of ENDPOINTS) {
    const parameters = e.params
      .filter((p) => p.in !== 'body')
      .map((p) => ({
        name: p.name,
        in: p.in,
        required: p.in === 'path' ? true : !!p.required,
        description: p.description,
        schema: p.type === 'integer' ? { type: 'integer' } : p.type === 'string[]' ? { type: 'array', items: { type: 'string' } } : { type: 'string' },
      }))
    const hasBody = e.params.some((p) => p.in === 'body')
    const op: Record<string, unknown> = {
      summary: e.summary,
      operationId: `${e.method.toLowerCase()}_${e.path.replace(/[^a-zA-Z]+/g, '_').replace(/^_|_$/g, '')}`,
      security: [{ bearerAuth: [] }],
      'x-required-scope': e.scope,
      ...(e.mcpTool ? { 'x-mcp-tool': e.mcpTool } : {}),
      parameters,
      ...(hasBody
        ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } } }
        : {}),
      responses: {
        '200': { description: 'OK' },
        '400': { $ref: '#/components/responses/Error' },
        '401': { $ref: '#/components/responses/Error' },
        '403': { $ref: '#/components/responses/Error' },
        '429': { $ref: '#/components/responses/Error' },
      },
    }
    ;(paths[e.path] ??= {})[e.method.toLowerCase()] = op
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'API REST · Bitácora de Novedades',
      version: '1.0.0',
      description: 'Acceso programático a la Bitácora con tokens Bearer (btk_…) con scopes. Mismas capacidades que el MCP.',
    },
    servers: [{ url: origin ? `${origin}/api/v1` : API_BASE_URL }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: `Scopes: ${Object.keys(SCOPES).join(', ')}` } },
      responses: {
        Error: {
          description: 'Error',
          content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } } } } },
        },
      },
    },
  }
}
