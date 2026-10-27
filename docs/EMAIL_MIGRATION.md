# Correos de novedades: del Apps Script a la app (SMTP)

Hasta ahora el correo lo armaba y enviaba un Apps Script al que la app le hacía un POST. Ahora la app
envía por SMTP con `data.news@alegra.com` (nombre visible «Alegra Product News»), con la misma plantilla de
Alegra, y muestra en pantalla, MCP y API si se envió o por qué falló.

## Cómo funciona

- **Un solo servicio** (`src/lib/email/service.ts`) atiende el botón «Enviar email», el envío automático
  al completar una novedad, la tool `notify_pmkt` del MCP y `POST /api/v1/records/{id}/notify-pmkt`.
- **Validación** (los mismos campos de antes): título, breve descripción, fecha de lanzamiento, fecha real
  de producción, responsables y al menos un correo válido en «Correos a comunicar». Solo Novedad / Pre-novedad.
- **Una sola comunicación por novedad**, garantizada en la base de datos (`EmailDelivery.lockKey`). Reenviar
  lo puede hacer cualquier usuario, con aviso de «ya se comunicó» y un motivo obligatorio que queda en el historial.
- **Direcciones inválidas**: se envía a las válidas y se avisa cuáles se omitieron.
- **Plantilla** editable en Admin → Correos → Plantilla (Handlebars, con versiones). Lo opcional va en
  `{{#if campo}}…{{/if}}`: si falta, no sale en el correo.
- **Chat**: en modo En vivo la app publica la tarjeta en el canal `tp-product-update`. No hay tarjeta de error:
  los errores se ven en la app.

## Modos de envío (Admin → Correos → Configuración)

| Modo | Qué pasa | Para qué |
|---|---|---|
| `webhook` | Todo como hoy: el Apps Script envía y publica su tarjeta | Estado inicial (sin cambios) |
| `shadow` | El Apps Script envía de verdad; la app prepara el mismo correo sin enviarlo | Comparar antes de cambiar |
| `test` | La app envía por SMTP **solo a los correos de prueba** | Ver llegar el correo real |
| `live` | La app envía por SMTP a los destinatarios reales y avisa en Chat | Producción |

El cambio es inmediato y sin redeploy; volver a `webhook` es el rollback.

## Configuración en Cloud Run

Variables (no secretas) y la contraseña como secreto:

```bash
PROJECT=automations-novedades-app
REGION=us-east1
SA=$(gcloud run services describe bitacora-app --project $PROJECT --region $REGION --format='value(spec.template.spec.serviceAccountName)')
# si sale vacío, es la cuenta por defecto de Compute: <NÚMERO-DE-PROYECTO>-compute@developer.gserviceaccount.com

# 1) La contraseña de aplicación de data.news@alegra.com como secreto (nunca en el repo ni en la base)
printf '%s' 'LA_CONTRASEÑA_DE_APLICACION' | gcloud secrets create bitacora-smtp-pass --project $PROJECT --data-file=-
gcloud secrets add-iam-policy-binding bitacora-smtp-pass --project $PROJECT \
  --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor

# 2) Variables del servicio
gcloud run services update bitacora-app --project $PROJECT --region $REGION \
  --update-env-vars SMTP_HOST=smtp.gmail.com,SMTP_PORT=587,SMTP_USER=data.news@alegra.com,APP_PUBLIC_URL=https://bitacora-novedades.alegra.com \
  --update-secrets SMTP_PASS=bitacora-smtp-pass:latest
```

| Variable | Valor | Notas |
|---|---|---|
| `SMTP_HOST` | `smtp.gmail.com` | |
| `SMTP_PORT` | `587` | STARTTLS (el 25 está bloqueado en Google Cloud) |
| `SMTP_USER` | `data.news@alegra.com` | también es el remitente |
| `SMTP_PASS` | contraseña de aplicación | **secreto** |
| `APP_PUBLIC_URL` | `https://bitacora-novedades.alegra.com` | dominio de los links del correo |
| `PMKT_CHAT_WEBHOOK_URL` | webhook del canal `tp-product-update` | idealmente también como secreto |
| `EMAIL_TEST_DOMAINS` | `alegra.com` (por defecto) | dominios permitidos para correos de prueba |

La contraseña de aplicación se crea en la cuenta de Google (Seguridad → Verificación en 2 pasos → Contraseñas de
aplicación). Si el admin de Workspace las tiene bloqueadas, hay que habilitarlas o usar el relay SMTP.

## Pasos del traslado

1. **Desplegar** el código con el modo `webhook` (comportamiento igual al de hoy). Antes: `prisma db push`
   en producción (tablas `EmailSettings`, `EmailTemplate`, `EmailTemplateRevision`, `EmailDelivery`; cambio aditivo).
2. **Importar el historial** para no reenviar lo ya comunicado (ver abajo).
3. **Cargar la contraseña y las variables** (sección anterior) y en Admin → Correos → Configuración pulsar
   **Verificar conexión** (debe decir «Conexión y credenciales correctas»).
4. **Modo `shadow`** unos días. En la pestaña Envíos revisa la comparación: el Apps Script sigue enviando y
   la app muestra el correo que habría enviado. Revisa también los «sospechosos» (el script respondió 200 sin
   `success`: puede haber fallado por dentro). Usa **Pruebas y simulacro** para ver el correo de novedades reales.
5. **Modo `test`** con tus correos de prueba: completa/edita una novedad o pulsa Ejecutar y comprueba que el correo
   real llega a tu bandeja (y a nadie más).
6. **Modo `live`**. Prueba con una novedad real y mira el resultado en pantalla y el historial.
7. **Apaga el Apps Script** (desactiva el despliegue de la web app). Si algo falla, vuelve a `webhook` mientras
   tanto.
8. **Limpieza** (commit aparte cuando esté confirmado): quitar `legacy-webhook.ts`, los modos `webhook`/`shadow`,
   la configuración antigua del campo botón y `sendAllFields`/`selectedFieldIds`.

## Importar el historial previo

La hoja `Historial` del Apps Script era lo que impedía enviar dos veces la misma novedad. Exporta esa hoja a CSV
(Archivo → Descargar → CSV; columna F con el link de cada novedad) y, con la **conexión directa** a la base de
datos (puerto 5432, no el pooler 6543):

```powershell
$env:DATABASE_URL = "<URL directa de producción>"
npx tsx scripts/import-legacy-email-history.ts --file historial.csv            # simulacro: no escribe
npx tsx scripts/import-legacy-email-history.ts --file historial.csv --apply    # escribe
```

El script también importa los `NOTIFIED_PMKT` de la versión anterior de la app. Es idempotente. Si el simulacro
muestra filas inválidas o novedades que no existen en la base, revísalas antes de aplicar.

## Errores y qué hacer

| Código | Significa | Qué hacer |
|---|---|---|
| `VALIDATION` | Faltan datos obligatorios (la respuesta trae la lista) | Completar la novedad |
| `DUPLICATE` | Ya se comunicó (dice quién y cuándo) | Cualquier usuario puede reenviar, con aviso y motivo obligatorio (10 a 500 caracteres) |
| `IN_PROGRESS` | Hay otro envío en curso | Esperar unos segundos |
| `SMTP_NOT_CONFIGURED` | Falta `SMTP_HOST`, `SMTP_USER` o `SMTP_PASS` | Ver Configuración en Cloud Run |
| `SMTP_AUTH` | Usuario o contraseña de aplicación inválidos | Regenerar la contraseña de aplicación |
| `RECIPIENT_REJECTED` | El servidor rechazó direcciones (la respuesta dice cuáles) | Corregir «Correos a comunicar» |
| `RATE_LIMIT` | Se alcanzó el límite diario/por minuto de la cuenta | Reintentar más tarde |
| `CONNECTION` / `TIMEOUT` | No hay conexión con `smtp.gmail.com:587` | Reintentar; revisar red/egreso |
| `TEMPLATE` | La plantilla tiene un error | Corregir en Admin → Plantilla (o restaurar una versión) |
| `MODE_CONFIG` | El modo elegido no tiene lo que necesita | Ver Configuración (correos de prueba, botón del Apps Script) |

El detalle técnico (respuesta del servidor SMTP) lo ve solo un ADMIN, en la pantalla y en Admin → Envíos.

## Pruebas

- `npm run test:db:up` levanta Postgres y Mailpit (SMTP de captura, http://localhost:8025) para los tests.
- `npm test`: suite completa (servicio, transporte, plantilla, admin, MCP, API, UI).
- E2E por HTTP: ver la cabecera de `tests/e2e/email-smoke.ts`.

## TMDIAPD-56: todos los tipos, «¿Trae video?», destinatarios y menciones en Chat

- **Decisión final de PMKT (27/10/2026): solo se comunican las Novedades y las Pre-novedades.** Los demás tipos
  (Mejora técnica, Experimento, Normativa, Novedades pequeñas, Resolución de Issues…) no se envían, ni solos ni con el
  botón (`COMMUNICABLE_TIPOS` en `src/lib/email/communication.ts`; para abrir otro tipo basta agregarlo ahí). El envío
  automático solo aplica a registros creados desde la fecha de corte (`COMMUNICATION_SINCE` en `src/lib/email/communication.ts`, el momento del despliegue): nada retroactivo.
- **Obligatorios para comunicar:** Título, Breve descripción, Fecha de lanzamiento, Fecha real de producción, al
  menos un Responsable y **¿Trae video?** (Sí/No). Con **Sí** también hace falta **Video**. Si falta algo no se envía y
  la novedad queda **pendiente** (etiqueta «⏳ Falta: …» en la tabla y en el detalle); al completarlo y guardar, el
  correo sale solo. «Correos a comunicar» pasó a ser informativo.
- **Destinatarios:** se configuran en Admin → Correos. Por defecto y en producción: el grupo `tm-alegra@alegra.com`
  (lo reciben todos sus miembros). El correo va solo a ellos. *Solo aplica en modo En vivo*: en Apps Script/Sombra el script sigue usando
  «Correos a comunicar» del registro.
- **Chat:** la tarjeta puede mencionar a los destinatarios (`<users/ID>` en el texto del mensaje), pero ahora no se
  menciona a nadie: cada destinatario tiene la casilla «Mencionar en Chat» (`mention: false` para tm-alegra, que
  tampoco se busca en el IT Hub). El mecanismo queda implementado para cuando PMKT programe su proceso. Los IDs se resuelven con el
  IT Hub (`IT_HUB_URL`, `IT_HUB_API_KEY`, scope `google-user`) la primera vez y se guardan; si el IT Hub falla, el
  correo y la tarjeta salen igual con los nombres sin notificar. Admin → Correos → «Mensaje de prueba en Chat»
  publica una prueba (en `PMKT_CHAT_TEST_WEBHOOK_URL` si existe; si no, en el canal real).

### Pasos de despliegue (en este orden)

1. `npx prisma db push` en producción (columna nueva `EmailSettings.notifyRecipients`, aditiva). **Antes** de desplegar.
2. Preparar los datos (simulacro primero; imprime las opciones reales de «Tipo»):
   `npx tsx scripts/setup-tmdiapd-56.ts` y luego `--apply` (crea «¿Trae video?» y unifica «Pre novedad»).
3. Desplegar. Hasta que exista el campo «¿Trae video?» esa regla se omite (no bloquea nada).
4. En Admin → Correos: **Resolver IDs de Chat**, guardar y probar con **Mensaje de prueba en Chat**.
