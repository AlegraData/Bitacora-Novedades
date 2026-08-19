import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserProfile } from '@/lib/actions/users'
import { Navbar } from '@/components/navbar'
import { McpSetup } from '@/components/mcp-setup'

export const metadata = {
  title: 'Conectar MCP · Bitácora Novedades Product',
}

export default async function McpPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const userProfile = await getCurrentUserProfile()
  if (!userProfile) redirect('/auth/login')

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f0f4f8' }}>
      <Navbar
        userName={userProfile.name ?? userProfile.email.split('@')[0]}
        userEmail={userProfile.email}
        userImage={userProfile.image}
        userRole={userProfile.role}
      />
      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        <McpSetup />
      </div>
    </div>
  )
}
