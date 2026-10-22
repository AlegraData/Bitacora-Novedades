import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { prisma } from '@/lib/prisma'
import { loadFieldMap } from '@/lib/mcp/fields'
import type { Prisma } from '@/generated/prisma'
import type { SendActor } from '@/lib/email/service'
import { COMMUNICATION_SINCE } from '@/lib/email/communication'

export const admin: SendActor = { id: null, email: 'admin@alegra.com', name: 'Admin', role: 'ADMIN' }
export const viewer: SendActor = { id: null, email: 'viewer@alegra.com', name: 'Viewer', role: 'VIEWER' }

export const FULL = {
  tipo: 'Novedad',
  titulo: 'Facturación masiva',
  breveDescripcion: 'Ahora puedes facturar en lote.',
  fechaLanzamiento: '2026-11-01',
  fechaProduccion: '2026-11-05',
  responsables: ['ana@alegra.com'],
  correosAComunicar: ['dest1@alegra.com', 'dest2@alegra.com'],
  elaborado: ['ana@alegra.com'],
  producto: ['Alegra POS'],
  traeVideo: 'No',
} as Record<string, unknown>

/** Crea un registro con datos por clave lógica (la misma traducción que usa el MCP). */
export async function makeRecord(overrides: Record<string, unknown> = {}, createdAt?: Date) {
  const map = await loadFieldMap()
  const logical = { ...FULL, ...overrides }
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(logical)) {
    const info = map.get(k)
    if (info && v !== undefined) data[info.id] = v
  }
  return prisma.record.create({
    data: { data: data as Prisma.InputJsonValue, createdByEmail: 'ana@alegra.com', createdByName: 'Ana', createdAt: createdAt ?? new Date(COMMUNICATION_SINCE.getTime() + 86_400_000) },
  })
}

export async function setMode(mode: 'webhook' | 'shadow' | 'test' | 'live', extra: { testRecipients?: string[] } = {}) {
  await prisma.emailSettings.upsert({
    where: { id: 'singleton' },
    update: { mode, ...extra },
    create: { mode, ...extra },
  })
}

export interface TestServer {
  url: string
  requests: { method: string; url: string; body: string }[]
  close: () => Promise<void>
  respond: { status: number; body: string }
}

/** Servidor HTTP local que hace de Apps Script o de webhook de Chat. */
export async function startServer(initial = { status: 200, body: '{"status":"success"}' }): Promise<TestServer> {
  const requests: TestServer['requests'] = []
  const state = { ...initial }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', body })
      res.statusCode = state.status
      res.end(state.body)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}/hook`,
    requests,
    respond: state,
    close: () => new Promise((r) => server.close(() => r())),
  }
}

export async function makeWebhookButton(url: string) {
  return prisma.field.create({
    data: { name: 'Enviar email', type: 'button', order: 999, config: { action: 'webhook', webhookUrl: url } },
  })
}
