import { createClient } from '@/lib/supabase/server'
import { getPublicOrigin } from '@/lib/get-public-origin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const origin = getPublicOrigin(request.headers, request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/app'

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      if (data.user?.email?.endsWith('@alegra.com')) {
        return NextResponse.redirect(`${origin}${next}`)
      }
      await supabase.auth.signOut()
      return NextResponse.redirect(`${origin}/auth/login?error=domain`)
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth`)
}
