import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserProfile } from '@/lib/actions/users'
import { getFields } from '@/lib/actions/fields'
import { getTags } from '@/lib/actions/tags'
import { getRecords } from '@/lib/actions/records'
import { Navbar } from '@/components/navbar'
import { RecordsTable } from '@/components/records-table'

export const metadata = {
  title: 'Bitácora Novedades Product | Alegra',
}

export default async function AppPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const [userProfile, fields, tags, records] = await Promise.all([
    getCurrentUserProfile(),
    getFields(),
    getTags(),
    getRecords(),
  ])

  if (!userProfile) redirect('/auth/login')

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f0f4f8', overflow: 'hidden' }}>
      <Navbar
        userName={userProfile.name}
        userEmail={userProfile.email}
        userImage={userProfile.image}
        userRole={userProfile.role}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <RecordsTable
          fields={fields}
          records={records}
          allTags={tags}
          userRole={userProfile.role}
          userEmail={userProfile.email}
          userName={userProfile.name}
        />
      </div>
    </div>
  )
}
