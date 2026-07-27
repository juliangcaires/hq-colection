'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function signUp(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({ email, password })

  if (error) {
    redirect(`/criar-conta?error=${encodeURIComponent(error.message)}`)
  }

  redirect('/login?message=Conta criada. Verifique seu e-mail se a confirmação estiver ativada.')
}
