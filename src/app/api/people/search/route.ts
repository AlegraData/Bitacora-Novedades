import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json([])

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  const token = session?.provider_token
  if (!token) {
    return NextResponse.json({ error: 'session_expired' }, { status: 401 })
  }

  const url = new URL('https://people.googleapis.com/v1/people:searchDirectoryPeople')
  url.searchParams.set('query', q)
  url.searchParams.set('readMask', 'names,emailAddresses,photos')
  url.searchParams.set('sources', 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE')
  url.searchParams.set('pageSize', '8')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    console.error('People API error:', res.status, await res.text())
    return NextResponse.json({ error: 'google_api_error' }, { status: res.status })
  }

  const data = await res.json()

  const people = ((data.people ?? []) as Record<string, any>[])
    .map((p) => ({
      name: (p.names as any[])?.[0]?.displayName ?? '',
      email: (p.emailAddresses as any[])?.[0]?.value ?? '',
      photo: (p.photos as any[])?.[0]?.url ?? null,
    }))
    .filter((p) => p.name || p.email)

  return NextResponse.json(people)
}
