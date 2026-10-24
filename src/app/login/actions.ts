'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { codigoDoErroAuth } from '@/lib/auth-mensagens'

// 72 é o limite de bytes do bcrypt que o Supabase usa; acima disso a senha seria truncada em silêncio.
const credenciaisSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(72),
})

export async function signIn(formData: FormData) {
  const parsed = credenciaisSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) redirect('/login?erro=credenciais')

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    redirect(`/login?erro=${codigoDoErroAuth(error, 'login')}`)
  }

  redirect('/')
}
