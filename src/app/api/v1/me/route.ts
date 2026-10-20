import { prisma } from '@/lib/prisma'
import { apiRoute, apiJson } from '@/lib/api/http'

export const GET = apiRoute(null, async ({ caller, keyId }) => {
  const key = await prisma.apiKey.findUniqueOrThrow({ where: { id: keyId } })
  return apiJson({
    user: { email: caller.email, name: caller.name, role: caller.role },
    token: {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      scopes: key.scopes,
      expiresAt: key.expiresAt.toISOString(),
      createdAt: key.createdAt.toISOString(),
    },
  })
})
