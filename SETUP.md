# Guía de Configuración - Bitácora Novedades Product

## Requisitos previos
- Node.js 18+
- Una cuenta en [Supabase](https://supabase.com) (gratis)
- Una cuenta en [Vercel](https://vercel.com) (opcional, para despliegue)
- Una API key de [OpenAI](https://platform.openai.com) (opcional, para el chatbot)

---

## 1. Configurar Supabase

### 1.1 Crear el proyecto
1. Ir a [supabase.com](https://supabase.com) → New Project
2. Darle el nombre **bitacora-prod** (o **bitacora-staging** para pruebas)
3. Guardar la contraseña de la base de datos

### 1.2 Habilitar Google OAuth
1. Dashboard → Authentication → Providers → Google
2. Habilitar y configurar con las credenciales de Google Cloud OAuth

### 1.3 Obtener las credenciales
En **Settings → API**:
- `NEXT_PUBLIC_SUPABASE_URL` = Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon/public key

En **Settings → Database → Connection string → Transaction mode**:
- `DATABASE_URL` = Pooler connection string (con `?pgbouncer=true`)
- `DIRECT_URL` = Session mode connection string (puerto 5432)

---

## 2. Variables de entorno

Copiar `.env.local.example` a `.env.local` y rellenar:

```bash
cp .env.local.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
DATABASE_URL=postgresql://postgres.xxxx:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.xxxx:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres
OPENAI_API_KEY=sk-...   # Opcional
```

El envío de correo/notificación PMKT no usa un proveedor de email propio: reutiliza el webhook de Apps Script configurado en el campo "Enviar email" (Field.config.webhookUrl), el mismo que usa el botón de la app web.

También actualizar `prisma.config.ts` para que use las variables correctas.

---

## 3. Configurar la base de datos

```bash
# Instalar dependencias
npm install

# Generar el cliente de Prisma
npx prisma generate

# Ejecutar las migraciones (crea todas las tablas)
npx prisma migrate deploy
```

---

## 4. Ejecutar en desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000)

---

## 5. Primer usuario administrador

1. Inicia sesión con Google en la app
2. En Supabase → Table Editor → `User` → busca tu registro
3. Cambia el campo `role` de `VIEWER` a `ADMIN`

Alternativamente, ejecuta en el SQL Editor de Supabase:
```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'tu@email.com';
```

---

## 6. Despliegue en Vercel

```bash
# Instalar Vercel CLI
npm i -g vercel

# Desplegar
vercel --prod
```

Agregar todas las variables de entorno en Vercel Dashboard → Settings → Environment Variables.

---

## Arquitectura

```
bitacora-app/
├── prisma/
│   └── schema.prisma          # Modelos de BD
├── src/
│   ├── app/
│   │   ├── page.tsx            # Landing page
│   │   ├── app/page.tsx        # App principal (protegida)
│   │   ├── admin/page.tsx      # Panel admin (solo ADMIN)
│   │   ├── auth/login/page.tsx # Login con Google
│   │   ├── auth/callback/      # Callback OAuth
│   │   └── api/
│   │       ├── export/         # Exportar CSV/Excel
│   │       └── chat/           # Chatbot con IA
│   ├── components/
│   │   ├── navbar.tsx          # Barra de navegación
│   │   ├── records-table.tsx   # Tabla principal
│   │   ├── record-editor.tsx   # Modal edición de registro
│   │   ├── field-editor.tsx    # Modal edición de campo
│   │   ├── admin-panel.tsx     # Panel de administración
│   │   └── chatbot.tsx         # Chat con IA
│   ├── lib/
│   │   ├── prisma.ts           # Cliente Prisma singleton
│   │   ├── supabase/           # Clientes Supabase
│   │   └── actions/            # Server Actions
│   └── types/index.ts          # Tipos TypeScript
└── SETUP.md                    # Esta guía
```

## Roles

| Rol | Permisos |
|-----|----------|
| `ADMIN` | Todo: gestionar campos, registros, usuarios, permisos |
| `MANAGER` | Crear y editar registros (según permisos de campos) |
| `VIEWER` | Solo visualizar registros |

## API REST (`/api/v1`) y tests

- Tokens `btk_…` con scopes, máximo 3 activos por usuario. Se gestionan en `/api-tokens` (usuarios) y en la pestaña **API Tokens** de `/admin`. Documentación: `/api-tokens` y `/api/v1/openapi.json`.
- **Antes de desplegar** hay que crear las tablas `ApiKey` y `ApiRequestLog` en la base real (cambio aditivo): `npx prisma db push` con el `DATABASE_URL` de producción.
- Variable opcional `API_RATE_LIMIT_PER_MIN` (default 120 por token y minuto, por instancia).
- Tests: `npm run test:db:up && npm run test:db:push` (Postgres+pgvector local en el puerto 54329) y luego `npm test`. Los tests se niegan a correr si la base no es localhost. E2E por HTTP: ver cabecera de `tests/e2e/api-smoke.ts`.

## Despliegue con GitHub Actions

El workflow `.github/workflows/deploy.yml` corre los tests en cada PR y push a `main`; en `main`, si pasan, construye la imagen con Cloud Build (proyecto `automations-novedades-app`) y despliega una revisión nueva de `bitacora-app` en `us-east1`. Al final hace un smoke test contra producción. Sin la configuración de abajo, solo corre los tests (el job de deploy se omite).

**Configuración única (la hace alguien con permisos de IAM en el proyecto):**

```bash
PROJECT=automations-novedades-app
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')

# 1) Service account del deploy
gcloud iam service-accounts create github-deployer --project $PROJECT
SA=github-deployer@$PROJECT.iam.gserviceaccount.com
for ROLE in roles/cloudbuild.builds.editor roles/run.admin roles/artifactregistry.writer roles/storage.admin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding $PROJECT --member serviceAccount:$SA --role $ROLE
done
# Debe poder "actuar como" la SA con la que corre Cloud Run (por defecto la de Compute):
gcloud iam service-accounts add-iam-policy-binding $PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --member serviceAccount:$SA --role roles/iam.serviceAccountUser --project $PROJECT

# 2) Workload Identity Federation limitada a ESTE repositorio (sin llaves JSON)
gcloud iam workload-identity-pools create github --project $PROJECT --location global
gcloud iam workload-identity-pools providers create-oidc github-actions --project $PROJECT --location global \
  --workload-identity-pool github --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping 'google.subject=assertion.sub,attribute.repository=assertion.repository' \
  --attribute-condition "assertion.repository=='AlegraData/Bitacora-Novedades'"
gcloud iam service-accounts add-iam-policy-binding $SA --project $PROJECT --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/AlegraData/Bitacora-Novedades"
```

**Variables del repositorio** (GitHub → Settings → Secrets and variables → Actions → *Variables*):

| Variable | Valor |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/github-actions` |
| `GCP_SERVICE_ACCOUNT` | `github-deployer@automations-novedades-app.iam.gserviceaccount.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | el mismo valor que tiene el servicio en Cloud Run |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ídem (es una llave pública, por eso va como variable) |

Recomendado: en Settings → Environments crear `production` con revisores requeridos y referenciarlo en el job `deploy` si quieres aprobación manual antes de cada despliegue. Los secretos de runtime (`DATABASE_URL`, `GEMINI_API_KEY`, …) siguen viviendo en el servicio de Cloud Run y no pasan por GitHub.
