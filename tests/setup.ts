// Se carga con `node --import` ANTES de cualquier módulo de la app, así
// `@/lib/prisma` lee la URL de la base de pruebas y nunca la de .env.local.
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:test@localhost:54329/bitacora_test'

const host = new URL(url).hostname
if (host !== 'localhost' && host !== '127.0.0.1') {
  throw new Error(`Los tests solo corren contra una base local (recibido host "${host}"). Abortando para no tocar datos reales.`)
}

process.env.DATABASE_URL = url
delete process.env.GEMINI_API_KEY
delete process.env.PMKT_CHAT_WEBHOOK_URL

// SMTP: siempre el servidor de captura local (Mailpit); nunca credenciales reales.
const smtpHost = process.env.TEST_SMTP_HOST ?? 'localhost'
if (smtpHost !== 'localhost' && smtpHost !== '127.0.0.1') {
  throw new Error(`Los tests solo envían correo a un SMTP local (recibido "${smtpHost}").`)
}
process.env.SMTP_HOST = smtpHost
process.env.SMTP_PORT = process.env.TEST_SMTP_PORT ?? '1025'
process.env.SMTP_USER = 'data.news@alegra.com'
delete process.env.SMTP_PASS
process.env.SMTP_SECURE = 'false'
process.env.APP_PUBLIC_URL = 'https://bitacora.test'
