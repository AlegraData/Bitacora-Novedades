import { OAuth2Client } from 'google-auth-library'
import { prisma } from '@/lib/prisma'
import { createMonitorStatusHandler } from '@/lib/monitor-status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// La descarga de certificados de Google no trae timeout propio: se acota para que un Google lento no cuelgue el endpoint.
const oauthClient = new OAuth2Client({ transporterOptions: { timeout: 8_000 } })

// La audiencia es el origen público de la app (el que usa el monitor al pedir el token): MONITOR_AUDIENCE si se define,
// y si no APP_PUBLIC_URL. Sin MONITOR_SA_EMAIL el endpoint queda cerrado.
export const GET = createMonitorStatusHandler({
  verifyToken: async (idToken, audience) => (await oauthClient.verifyIdToken({ idToken, audience })).getPayload(),
  checkDatabase: async () => {
    await prisma.$queryRaw`SELECT 1`
  },
  config: () => ({
    monitorSaEmail: process.env.MONITOR_SA_EMAIL,
    audience: (process.env.MONITOR_AUDIENCE || process.env.APP_PUBLIC_URL)?.replace(/\/+$/, ''),
    version: process.env.K_REVISION ?? null,
  }),
})
