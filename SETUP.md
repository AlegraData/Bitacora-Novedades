# Guía de Configuración - Bitácora Novedades Product

## Requisitos previos
- Node.js 18+
- Una cuenta en [Supabase](https://supabase.com) (gratis)
- Una cuenta en [Vercel](https://vercel.com) (opcional, para despliegue)
- Una API key de [OpenAI](https://platform.openai.com) (opcional, para el chatbot)
- Una API key de [Resend](https://resend.com) (opcional, para emails)

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
RESEND_API_KEY=re_...   # Opcional
RESEND_FROM_EMAIL=Bitácora <noreply@tudominio.com>
```

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
