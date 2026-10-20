import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserProfile } from '@/lib/actions/users'
import { getMyApiKeys } from '@/lib/actions/api-keys'
import { Navbar } from '@/components/navbar'
import { ApiKeysManager } from '@/components/api-keys/api-keys-manager'
import { ApiDocs } from '@/components/api-keys/api-docs'

export const metadata = {
  title: 'API · Bitácora Novedades Product',
}

export default async function ApiTokensPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const userProfile = await getCurrentUserProfile()
  if (!userProfile) redirect('/auth/login')

  const keys = await getMyApiKeys()

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f0f4f8' }}>
      <Navbar
        userName={userProfile.name ?? userProfile.email.split('@')[0]}
        userEmail={userProfile.email}
        userImage={userProfile.image}
        userRole={userProfile.role}
      />
      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <Link href="/app" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#4a5568', textDecoration: 'none', marginBottom: 16 }}>
            ← Volver a novedades
          </Link>
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a202c' }}>API de Bitácora</h1>
            <p style={{ fontSize: 14, color: '#718096', marginTop: 4 }}>
              Consulta y gestiona novedades desde tus scripts y servicios con tokens personales, respetando tu rol y permisos.
            </p>
          </div>

          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1a202c', marginBottom: 10 }}>Mis tokens</h2>
          <div style={{ marginBottom: 32 }}>
            <ApiKeysManager initialKeys={keys} mode="user" isAdmin={userProfile.role === 'ADMIN'} currentUserEmail={userProfile.email} />
          </div>

          <ApiDocs />
        </div>
      </div>
    </div>
  )
}
