# Blueprint: Migración Bitácora de Novedades a Next.js + Supabase + Prisma

Este documento describe la arquitectura, el modelo de datos y la infraestructura necesaria para migrar el prototipo de Google Apps Script a una aplicación web moderna y escalable.

## 1. Stack Tecnológico || 4UUpWwc?U2s*9jF
- **Frontend:** Next.js 14+ (App Router), Tailwind CSS, Shadcn/UI.
- **Backend:** Next.js Server Actions & API Routes.
- **Base de Datos:** PostgreSQL (vía Supabase).
- **ORM:** Prisma.
- **Autenticación:** Supabase Auth (Google OAuth & Email/Password).
- **Almacenamiento:** Supabase Storage (para fotos de perfil/adjuntos).
- **IA/Chatbot:** OpenAI SDK / LangChain con Supabase Vector (pgvector).
- **Despliegue:** Vercel (Frontend) y Supabase (Database/Backend).

## 2. Arquitectura de Base de Datos (Prisma Schema)

El modelo de datos debe soportar la naturaleza dinámica de los campos del prototipo original.

```prisma
// schema.prisma

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  ADMIN
  MANAGER
  VIEWER
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  image         String?
  role          Role      @default(VIEWER)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  auditLogs     AuditLog[]
}

model Field {
  id           String    @id @default(cuid())
  name         String
  type         String    // text, textarea, number, date, select, multiselect, person, button, etc.
  order        Int       @default(0)
  isFilterable Boolean   @default(true)
  isVisible    Boolean   @default(true)
  config       Json?     // Configuración adicional (ej. templates de correo para botones)
  options      Tag[]     // Opciones para selects
  permissions  FieldPermission[]
}

model Tag {
  id        String   @id @default(cuid())
  fieldId   String
  field     Field    @relation(fields: [fieldId], onDelete: Cascade)
  name      String
  color     String   @default("#e2e8f0")
  order     Int      @default(0)
}

model Record {
  id              String   @id @default(cuid())
  data            Json     // Almacena los valores dinámicos: { "field_id": "valor" }
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  createdByEmail  String
  createdByName   String
}

model FieldPermission {
  id        String   @id @default(cuid())
  fieldId   String
  field     Field    @relation(fields: [fieldId], onDelete: Cascade)
  role      Role
  canEdit   Boolean  @default(true)
}

model AuditLog {
  id         String   @id @default(cuid())
  timestamp  DateTime @default(now())
  userId     String?
  user       User?    @relation(fields: [userId], onDelete: SetNull)
  userEmail  String
  userName   String
  action     String   // CREATED_RECORD, UPDATED_FIELD, etc.
  recordId   String?
  details    Json?
}
```

## 3. Estrategia de Migraciones y Entornos
Se deben manejar dos proyectos en Supabase: `bitacora-staging` (Pruebas) y `bitacora-prod` (Producción).

- **Flujo de Migración:**
  1. Realizar cambios en `schema.prisma`.
  2. Ejecutar `npx prisma migrate dev --name <descripcion>` localmente.
  3. Para staging: Configurar `DATABASE_URL` de staging y ejecutar `npx prisma migrate deploy`.
  4. Para producción: Repetir con la URL de producción.

## 4. Gestión de Accesos (RBAC & Field-Level Permissions)
- **Panel de Administración:** Una vista exclusiva para `ADMIN` donde se asocian Roles con permisos de edición sobre cada `FieldId`.
- **Middleware:** Protección de rutas basado en el rol de la sesión de Supabase.
- **Control de UI:** Los campos en el formulario de edición se renderizan como "Read-only" si el rol del usuario no tiene `canEdit: true` en `FieldPermission`.

## 5. Funcionalidad de Exportación
- Implementar un endpoint `/api/export` que:
  1. Reciba filtros (opcional).
  2. Consulte los datos dinámicos de `Record`.
  3. Mapee las llaves JSON (`field_id`) a los nombres legibles de `Field`.
  4. Genere un archivo CSV o Excel usando la librería `xlsx`.

## 6. Chatbot de Contexto (RAG - Retrieval Augmented Generation)
Para que el chatbot entienda la base de datos:
- **Embeddings:** Cada vez que se crea o actualiza un `Record`, convertir su contenido JSON a texto plano y generar un vector (embedding) usando OpenAI (`text-embedding-3-small`).
- **Almacenamiento Vectorial:** Guardar los vectores en una tabla dedicada en Supabase usando la extensión `pgvector`.
- **Proceso de Consulta:**
  1. El usuario pregunta al chatbot.
  2. Se genera el vector de la pregunta.
  3. Se realiza una búsqueda de similitud en la tabla de vectores para obtener los registros más relevantes.
  4. Se envía la pregunta + registros relevantes como contexto al LLM (GPT-4o) para generar la respuesta.

## 7. Pasos de Ejecución para la IA Desarrolladora
1. **Setup Inicial:** Configurar Next.js con Tailwind y Prisma.
2. **Supabase Integration:** Configurar el cliente de Supabase y la autenticación con Google.
3. **Core CRUD:** Implementar la lógica para gestionar `Fields` y `Records` (JSONB dinámico).
4. **RBAC Logic:** Crear el sistema de permisos por campo y roles.
5. **UI Dinámica:** Recrear la tabla con columnas fijas y los modales de edición del prototipo.
6. **Chatbot Implementation:** Configurar la tabla de vectores y el pipeline de RAG.
7. **Export Tool:** Crear el generador de reportes.
