'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { codigoDoErroAuth } from '@/lib/auth-mensagens'

const cadastroSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(72),
})

export async function signUp(formData: FormData) {
  const parsed = cadastroSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) redirect('/criar-conta?erro=dados')

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp(parsed.data)

  if (error) {
    redirect(`/criar-conta?erro=${codigoDoErroAuth(error, 'cadastro')}`)
  }

  redirect('/login?aviso=conta-criada')
}
