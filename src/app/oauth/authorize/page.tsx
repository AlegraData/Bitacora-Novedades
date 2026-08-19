import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { authorizeAction, denyAction } from './actions'

function ErrorScreen({ message }: { message: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f4f8' }}>
      <div style={{ background: 'white', padding: 32, borderRadius: 12, maxWidth: 420, textAlign: 'center' }}>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>No se pudo continuar</h1>
        <p style={{ color: '#64748b' }}>{message}</p>
      </div>
    </div>
  )
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const get = (key: string) => {
    const value = params[key]
    return typeof value === 'string' ? value : ''
  }

  const clientId = get('client_id')
  const redirectUri = get('redirect_uri')
  const responseType = get('response_type')
  const codeChallenge = get('code_challenge')
  const codeChallengeMethod = get('code_challenge_method')
  const state = get('state')

  if (responseType !== 'code' || codeChallengeMethod !== 'S256' || !codeChallenge || !clientId || !redirectUri) {
    return <ErrorScreen message="Solicitud OAuth inválida o incompleta." />
  }

  const client = await prisma.oAuthClient.findUnique({ where: { clientId } })
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return <ErrorScreen message="Cliente OAuth no reconocido." />
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    const originalQuery = new URLSearchParams(
      Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ).toString()
    const next = `/oauth/authorize?${originalQuery}`
    redirect(`/auth/login?next=${encodeURIComponent(next)}`)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f4f8' }}>
      <div style={{ background: 'white', padding: 32, borderRadius: 12, maxWidth: 420, width: '100%' }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>Autorizar acceso al MCP</h1>
        <p style={{ color: '#334155', marginBottom: 4 }}>
          <strong>{client.name}</strong> quiere conectarse a Bitácora Novedades como:
        </p>
        <p style={{ color: '#0f172a', fontWeight: 600, marginBottom: 20 }}>{user.email}</p>
        <p style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>
          Va a poder leer y modificar novedades en tu nombre, según tu rol y permisos actuales.
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <form action={denyAction} style={{ flex: 1 }}>
            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="redirect_uri" value={redirectUri} />
            <input type="hidden" name="state" value={state} />
            <button
              type="submit"
              style={{ width: '100%', padding: '10px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer' }}
            >
              Cancelar
            </button>
          </form>
          <form action={authorizeAction} style={{ flex: 1 }}>
            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="redirect_uri" value={redirectUri} />
            <input type="hidden" name="code_challenge" value={codeChallenge} />
            <input type="hidden" name="state" value={state} />
            <button
              type="submit"
              style={{ width: '100%', padding: '10px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', cursor: 'pointer' }}
            >
              Autorizar
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
