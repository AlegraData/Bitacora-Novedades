import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserProfile, getAllUsers, updateUserRole } from '@/lib/actions/users'
import { getFields, saveFieldPermission } from '@/lib/actions/fields'
import { getAuditLogs } from '@/lib/actions/audit'
import { Navbar } from '@/components/navbar'
import { AdminPanel } from '@/components/admin-panel'

export const metadata = {
  title: 'Admin · Bitácora Novedades Product',
}

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const userProfile = await getCurrentUserProfile()
  if (!userProfile || userProfile.role !== 'ADMIN') redirect('/app')

  const [fields, users, auditLogs] = await Promise.all([
    getFields(),
    getAllUsers(),
    getAuditLogs(100),
  ])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f0f4f8' }}>
      <Navbar
        userName={userProfile.name}
        userEmail={userProfile.email}
        userImage={userProfile.image}
        userRole={userProfile.role}
      />
      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        <AdminPanel
          fields={fields}
          users={users.map(u => ({ ...u, role: u.role as 'ADMIN' | 'MANAGER' | 'VIEWER', name: u.name ?? u.email, image: u.image ?? null, createdAt: u.createdAt.toISOString(), updatedAt: u.updatedAt.toISOString() }))}
          auditLogs={auditLogs}
          onUpdateUserRole={updateUserRole}
          onSaveFieldPermission={saveFieldPermission}
        />
      </div>
    </div>
  )
}
