# Trazas del MCP en Phoenix

Cada llamada al MCP de la Bitácora (`/api/mcp`) se envía como traza a Phoenix, el Phoenix (Arize) propio de Alegra
(`https://phoenix-922441628887.us-central1.run.app`). Esto va **a la par** del registro que ya existía, que no
cambia:

- **Admin → Conexiones MCP** (`McpToolCall`): quién, con qué agente, qué herramienta, resultado y duración. Sin
  contenido.
- **Auditoría** (`AuditLog`): los cambios y las lecturas.

Phoenix agrega lo que esos registros no guardan:

- qué preguntó la persona;
- qué parámetros mandó el agente;
- qué le respondió el MCP;
- qué respondió el agente al final.

Es la misma forma que los MCP de Google Chat, Meet Wiki y Dashboards Hub, para que todos se lean igual.

Código: [`src/lib/mcp/tracing.ts`](../src/lib/mcp/tracing.ts) (trazas) y
[`src/lib/mcp/conversation.ts`](../src/lib/mcp/conversation.ts) (pregunta y respuesta).

## Qué se ve en Phoenix

Cada llamada genera dos spans:

```
mcp_orchestrator.bitacora   CHAIN (raíz)   quién, agente, rol, pregunta → respuesta, resultado
 └─ <herramienta>           TOOL           parámetros y resultado
```

- **Proyecto:** `alegra-mcp-bitacora-prod`. Sin `PHOENIX_PROJECT_NAME` se usa `alegra-mcp-bitacora-test`.
- **Persona (`user.id`):** el correo de quien hizo la llamada.
- **Sessions:** cada pregunta es una sesión, con todas las llamadas que el agente hizo para responderla y su
  respuesta final. Una llamada sin pregunta se agrupa por persona, conector y día.
- **Metadatos:** `agent` (Claude, Claude Code, opencode u Otro agente, según el nombre que declaró el cliente),
  `rol`, `record_id`, `status` (OK, ERROR o DENIED), `error_code`, `duration_ms`, `capture_mode`, `revision` y un
  resumen numérico del resultado. El resumen incluye, por ejemplo, `total`, `records_count`, `email_status` y
  `envio_status`.

## La pregunta y la respuesta (`MCP_CAPTURE_CONVERSATION=true`)

MCP no le entrega al servidor la conversación, solo las llamadas a herramientas. Para verla con cualquier agente
(claude.ai, Claude Code, OpenCode, Hermes…), sin configurar ningún cliente, el servidor se la pide al agente:

- **`pregunta_usuario`:** cada herramienta anuncia este parámetro obligatorio, el mensaje literal del usuario. La
  ruta lo **retira antes de ejecutar**: ni la herramienta, ni la auditoría, ni el registro del admin lo ven. Solo va
  a Phoenix.
- **`registrar_respuesta`:** una herramienta nueva para que el agente registre su respuesta final. No toca la
  Bitácora y responde un texto fijo. Admite 30 por minuto por cuenta. En el admin aparece como «Registrar respuesta».
- **Instrucciones del servidor:** la respuesta a `initialize` refuerza las dos reglas.

Es lo que el agente reporta, no una grabación: sirve para supervisar, no como prueba infalible.

Un agente que no manda la pregunta sigue funcionando.

**Modo estricto:** con `MCP_REQUIRE_QUESTION=true`, una llamada sin `pregunta_usuario` no se ejecuta, y el agente
recibe un error que le dice qué mandar. Conviene activarlo solo después de revisar en Phoenix que los agentes ya la
mandan.

Los conectores que ya estaban abiertos siguen con la lista vieja de herramientas hasta reconectar o abrir una
conversación nueva.

## Cuánto contenido sale (`PHOENIX_CAPTURE_MODE`)

| Modo | Pregunta y respuesta | Lo que se escribe | Lo que responde el MCP |
|---|---|---|---|
| `metadata` (por defecto) | Solo el tamaño | Campos cortos; de los extensos, solo el tamaño | Resumen numérico |
| `outbound` | Sí | Sí | Resumen numérico |
| `full` (producción) | Sí | Sí | Sí: novedades, auditoría, envíos y errores de validación, recortado a `PHOENIX_MAX_CONTENT_CHARS` (8000) |

- Campos extensos: `contenido`, `breveDescripcion`, `comentarioEvento`, `reason` y `respuesta`.
- Campos cortos: títulos, fechas, ids, filtros y correos, hasta 500 caracteres cada uno.

**En todos los modos:**

- Se enmascaran secretos reconocibles: tokens `btk_` de la API, `usuario:clave@` dentro de una URL (por ejemplo, la
  cadena de conexión de la base en un error de Prisma), JWT, llaves de Google, OpenAI, Supabase y GitHub, y
  `token=`, `password=`, `Bearer …`.
- A una llamada **rechazada** (rol insuficiente, límite, falta de pregunta) nunca se le guarda contenido.
- El identificador de la pregunta (`pregunta_id`) es un HMAC con una llave del servidor. Desde Phoenix no se puede
  confirmar una pregunta adivinándola.

## Falla abierto

Si falta `PHOENIX_COLLECTOR_ENDPOINT` o `PHOENIX_API_KEY`, el endpoint no es `https`, o Phoenix está caído o rechaza
la llave, el MCP funciona exactamente igual, sin trazas.

- Las trazas salen en segundo plano y ninguna herramienta espera a Phoenix.
- Si Phoenix no recibe, el log dice `[tracing] Phoenix no recibió trazas: …`, como mucho cada 5 minutos.

## Variables de entorno

| Variable | Valor en producción | Notas |
|---|---|---|
| `PHOENIX_COLLECTOR_ENDPOINT` | `https://phoenix-922441628887.us-central1.run.app` | Sin ella no hay trazas. |
| `PHOENIX_API_KEY` | Secreto `bitacora-phoenix-api-key` | System Key de Phoenix; **nunca** como texto plano. |
| `PHOENIX_PROJECT_NAME` | `alegra-mcp-bitacora-prod` | Phoenix crea el proyecto con la primera traza. |
| `PHOENIX_CAPTURE_MODE` | `full` | `metadata`, `outbound` o `full`. |
| `PHOENIX_MAX_CONTENT_CHARS` | (sin definir: 8000) | Entre 1000 y 100000. |
| `MCP_CAPTURE_CONVERSATION` | `true` | Pide la pregunta y habilita `registrar_respuesta`. |
| `MCP_REQUIRE_QUESTION` | `false` | Modo estricto. |
| `MCP_TRACE_HASH_KEY` | (opcional) | Llave del `pregunta_id`; si no existe, se deriva de `PHOENIX_API_KEY`. |

## Configuración en Cloud Run

Proyecto `automations-novedades-app`, servicio `bitacora-app` (us-east1). Corre con la cuenta por defecto de
Compute: `624765298141-compute@developer.gserviceaccount.com`.

```bash
PROJECT=automations-novedades-app
REGION=us-east1
SA=624765298141-compute@developer.gserviceaccount.com

# 1) La llave de Phoenix como secreto. Se crea en la consola, en Secret Manager, con el nombre
#    bitacora-phoenix-api-key. Después, solo la cuenta del servicio puede leerla:
gcloud secrets add-iam-policy-binding bitacora-phoenix-api-key --project $PROJECT \
  --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor

# 2) Variables del servicio. Usar --update-env-vars, NUNCA --set-env-vars, que borra las demás.
gcloud run services update bitacora-app --project $PROJECT --region $REGION \
  --update-env-vars PHOENIX_COLLECTOR_ENDPOINT=https://phoenix-922441628887.us-central1.run.app,PHOENIX_PROJECT_NAME=alegra-mcp-bitacora-prod,PHOENIX_CAPTURE_MODE=full,MCP_CAPTURE_CONVERSATION=true,MCP_REQUIRE_QUESTION=false \
  --update-secrets PHOENIX_API_KEY=bitacora-phoenix-api-key:latest
```

Cambiar de modo, encender o apagar no requiere rebuild: un `gcloud run services update … --update-env-vars …` crea
una revisión nueva.

- Para quitar el contenido: `PHOENIX_CAPTURE_MODE=metadata`.
- Para apagar la captura de la conversación: `MCP_CAPTURE_CONVERSATION=false`.

## Despliegue del código

No hay CI: se construye con Cloud Build y se despliega a mano, como en
[MONITOREO_IT_HUB.md](MONITOREO_IT_HUB.md).

- No hay cambios de base de datos: no hace falta `prisma db push`.
- `_NEXT_PUBLIC_SUPABASE_URL` y `_NEXT_PUBLIC_SUPABASE_ANON_KEY` son los mismos del despliegue anterior.

```bash
TAG=$(git rev-parse --short HEAD)
IMAGE=us-east1-docker.pkg.dev/automations-novedades-app/bitacora-app/bitacora-app:$TAG
gcloud builds submit --project automations-novedades-app --config cloudbuild.yaml \
  --substitutions _IMAGE=$IMAGE,_NEXT_PUBLIC_SUPABASE_URL=…,_NEXT_PUBLIC_SUPABASE_ANON_KEY=…
gcloud run deploy bitacora-app --project automations-novedades-app --region us-east1 --image $IMAGE
```

## Verificación

1. Log de la revisión nueva: `[tracing] Phoenix activo: proyecto alegra-mcp-bitacora-prod, modo full`.
2. Una consulta desde un conector, por ejemplo `list_records`, aparece en Phoenix → `alegra-mcp-bitacora-prod`.
3. Para ver pregunta → respuesta, abrir una conversación **nueva** en claude.ai y preguntar algo de la Bitácora.
   Aparece en Phoenix → `alegra-mcp-bitacora-prod` → **Sessions**.
4. Rechazos de Phoenix (llave equivocada o vencida):

   ```bash
   gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="bitacora-app" AND textPayload:"Phoenix no recibió"' --project automations-novedades-app --freshness=1d
   ```

## Rotar la llave

1. Crear una System Key nueva en Phoenix (Settings → API Keys).
2. Agregarla como **versión nueva** de `bitacora-phoenix-api-key`, en la consola.
3. Crear una revisión nueva para que se lea `latest` al arrancar, sin cambiar nada más:
   `gcloud run services update bitacora-app --project automations-novedades-app --region us-east1 --update-env-vars PHOENIX_KEY_ROTATED_AT=AAAA-MM-DD`.
4. Comprobar que siguen llegando trazas.
5. Borrar la llave vieja en Phoenix y desactivar la versión anterior del secreto.

Al cambiar la llave, cambia el `pregunta_id` derivado. Las preguntas anteriores no se mezclan con las nuevas.

## Riesgos

- Con `full`, quien entre a Phoenix ve las novedades, la auditoría y los envíos que consultan los agentes.
  Phoenix OSS no tiene permisos por proyecto, así que el acceso a Phoenix debe quedar en quienes supervisan.
- Conviene fijar una retención corta para `alegra-mcp-bitacora-prod`, por ejemplo 30 días (Settings → Data
  Retention).
- `agent` sale del nombre que declara el cliente al registrarse por OAuth: es informativo y se puede falsear.

## Pruebas

| Archivo | Cubre | Base de datos |
|---|---|---|
| `tests/mcp-conversation.test.ts` | Esquema con `pregunta_usuario`, `registrar_respuesta`, límite, modo estricto | No |
| `tests/mcp-tracing.test.ts` | Spans, modos, rechazadas sin contenido, secretos, recortes, sesiones | No |
| `tests/mcp-phoenix-route.test.ts` | La ruta completa con un exportador en memoria | Sí |

La prueba de la ruta comprueba que la pregunta no llega a la herramienta, a `AuditLog` ni a `McpToolCall`, que
`registrar_respuesta` no escribe nada, el modo estricto, el rol insuficiente, las excepciones y las herramientas
inexistentes.
