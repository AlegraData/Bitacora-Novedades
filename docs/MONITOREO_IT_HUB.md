# Bitácora y el monitor del IT Hub

Cómo está conectada Bitácora de Novedades al módulo de monitoreo del IT Hub (consola `/monitor/bitacora`), cómo se
despliega y qué hay pendiente. Diseño completo del monitor y guía general para sumar apps:
`alegra-it-hub-backend/docs/MONITOR_MODULE.md` y `docs/MONITOREO_IT_HUB.md` del repo de Meet Wiki.

## Dónde corre
| Dato | Valor |
|---|---|
| Proyecto GCP | `automations-novedades-app` |
| Servicio Cloud Run | `bitacora-app` (us-east1), cuenta `624765298141-compute@developer.gserviceaccount.com` |
| Dominio público | `https://bitacora-novedades.alegra.com` (la raíz redirige 307 a `/auth/login`) |
| Cloud Scheduler | **No está habilitado** en el proyecto: no hay jobs que vigilar |
| Despliegue | **Manual**: `gcloud builds submit --config cloudbuild.yaml` y `gcloud run deploy` (no hay CI en el repo) |

## Qué se agregó a la app
- `GET /api/monitor/status` (`src/app/api/monitor/status/route.ts` + `src/lib/monitor-status.ts`): contrato de salud
  (estado, versión de la revisión, check `database`). Lo consulta el monitor con un **token OIDC**:
  - solo entra **una cuenta**, `MONITOR_SA_EMAIL` (la cuenta de ejecución del backend del IT Hub,
    `711258266131-compute@developer.gserviceaccount.com`), con correo verificado;
  - la audiencia esperada es `MONITOR_AUDIENCE` si existe y, si no, `APP_PUBLIC_URL`
    (`https://bitacora-novedades.alegra.com`, el origen que usa el monitor al pedir el token);
  - sin `MONITOR_SA_EMAIL` o sin audiencia, el endpoint queda cerrado;
  - mismo 401 para toda causa de rechazo, `Cache-Control: no-store`, nada se toca antes de autenticar, detalle de error
    genérico (el mensaje de Prisma puede traer la cadena de conexión) y timeout de 3 s por check.
- `src/proxy.ts`: `api/monitor/` se excluye del matcher para que la sonda no dependa de Supabase Auth.
- Dependencia `google-auth-library` (validación del token OIDC, igual que Dashboards Hub y Meet Wiki).
- Pruebas: `tests/monitor-status.test.ts` (27 casos, sin base de datos: el manejador recibe sus dependencias por
  inyección). Validado con mutación: 13 de 14 defectos de seguridad detectados; el sobreviviente es equivalente
  (el `try/catch` ya devuelve 401 sin la comprobación redundante).

## Variables de entorno nuevas en Cloud Run
| Variable | Valor | Obligatoria |
|---|---|---|
| `MONITOR_SA_EMAIL` | `711258266131-compute@developer.gserviceaccount.com` | Sí (sin ella el endpoint responde siempre 401) |
| `MONITOR_AUDIENCE` | origen público si difiere de `APP_PUBLIC_URL` | No |

Añadirlas a la revisión no requiere rebuild: `gcloud run services update bitacora-app --project automations-novedades-app --region us-east1 --update-env-vars MONITOR_SA_EMAIL=…`.
**Ojo:** el despliegue manual con `gcloud run deploy --set-env-vars` reemplaza todas las variables; usa `--update-env-vars`.

## Permisos IAM para el monitor (solo lectura, los aplica una persona)
A la cuenta del backend del IT Hub en `automations-novedades-app`: `roles/run.viewer` (sonda de revisión) y
`roles/monitoring.viewer` (métricas de Cloud Run). No hace falta `cloudscheduler.viewer`.

## Sondas registradas en el monitor
HTTP de `/auth/login` (200), contrato `/api/monitor/status` (apagada hasta desplegar y activar "Salud profunda"),
MCP `POST /api/mcp` sin token (debe dar 401 con `WWW-Authenticate: Bearer`), Cloud Run (revisión lista) y métricas de
Cloud Run (5xx, p95, CPU, memoria). Alta en `alegra-it-hub-backend/supabase/migrations/20261105220000_monitor_bitacora.sql`.

## Corregido junto con el monitoreo: `WWW-Authenticate` no llegaba a los clientes
Los 401 de producción (`/api/mcp` y `/api/v1/*`) salían **sin** `WWW-Authenticate`: el `realm` era `"Bitácora …"` (con
"á") y el Google Frontend de Cloud Run descarta los encabezados con caracteres no ASCII. En local el servidor sí lo
emitía. Los `realm` ahora son ASCII (`Bitacora Novedades MCP/API`) y `tests/www-authenticate-ascii.test.ts` lo vigila.
La sonda `mcp-auth` del monitor exige ese encabezado, así que no quedará en verde hasta desplegar este cambio.

## Pendientes y hallazgos (5-nov-2026)
1. **Bucle de clientes MCP (≈40 % de respuestas 4xx en 24 h).** Hermes-Agent 0.21.x reintenta cada pocos segundos
   `POST /oauth/token` → 400 y `/.well-known/oauth-protected-resource` → 404. Bitácora tiene el mismo diseño que
   tenía Meet Wiki antes de su arreglo: renovación **no atómica** del refresh token (`src/app/oauth/token/route.ts`),
   sin metadatos RFC 9728 y sin freno. La solución ya probada está en Meet Wiki (PR #20: rotación atómica, gracia de
   30 s, 429 con `Retry-After`, metadatos y registro del motivo); se puede portar casi tal cual.
2. **Secreto en el repositorio:** `INFRASTRUCTURE_BLUEPRINT.md` (rastreado por git) trae en el encabezado de la sección 1
   una cadena con aspecto de contraseña. Si es real, **rotarla** y retirarla del archivo (y del historial si se desea).
3. El `proxy.ts` llama a `supabase.auth.getUser()` en cada petición no excluida (incluido `/api/mcp`); un Supabase
   lento afecta al MCP. Valorar excluir también `/api/mcp` y `/oauth/`.
