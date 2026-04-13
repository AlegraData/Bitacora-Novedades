import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { LoginClient } from './login-client'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  async function signInWithGoogle() {
    'use server'
    const supabase = await createClient()
    const headersList = await headers()
    const origin = headersList.get('origin') ?? 'http://localhost:3000'

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`,
        scopes: [
          'https://www.googleapis.com/auth/directory.readonly',
          'https://www.googleapis.com/auth/contacts.readonly',
        ].join(' '),
      },
    })

    if (error) throw error
    if (data.url) redirect(data.url)
  }

  return <LoginClient signInAction={signInWithGoogle} />
}
