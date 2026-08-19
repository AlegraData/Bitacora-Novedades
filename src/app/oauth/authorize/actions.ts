'use server'

import { randomBytes } from 'crypto'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

const CODE_TTL_MS = 10 * 60 * 1000

export async function authorizeAction(formData: FormData) {
  const clientId = String(formData.get('client_id') ?? '')
  const redirectUri = String(formData.get('redirect_uri') ?? '')
  const codeChallenge = String(formData.get('code_challenge') ?? '')
  const state = String(formData.get('state') ?? '')

  const client = await prisma.oAuthClient.findUnique({ where: { clientId } })
  if (!client || !client.redirectUris.includes(redirectUri)) {
    throw new Error('Cliente OAuth inválido')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    throw new Error('Sesión no encontrada')
  }

  const code = randomBytes(32).toString('base64url')
  await prisma.oAuthCode.create({
    data: {
      code,
      userEmail: user.email,
      clientId,
      redirectUri,
      codeChallenge,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  })

  const target = new URL(redirectUri)
  target.searchParams.set('code', code)
  if (state) target.searchParams.set('state', state)

  redirect(target.toString())
}

export async function denyAction(formData: FormData) {
  const clientId = String(formData.get('client_id') ?? '')
  const redirectUri = String(formData.get('redirect_uri') ?? '')
  const state = String(formData.get('state') ?? '')

  const client = await prisma.oAuthClient.findUnique({ where: { clientId } })
  if (!client || !client.redirectUris.includes(redirectUri)) {
    throw new Error('Cliente OAuth inválido')
  }

  const target = new URL(redirectUri)
  target.searchParams.set('error', 'access_denied')
  if (state) target.searchParams.set('state', state)

  redirect(target.toString())
}
