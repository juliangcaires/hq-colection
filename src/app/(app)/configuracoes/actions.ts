'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'

const contribuirSchema = z.boolean()

/** Liga ou desliga "Contribuir com as capas que eu enviar". Cria o perfil na primeira vez; desligado é o padrão. */
async function definirContribuirCapasImpl(valor: boolean) {
  const contribuir = contribuirSchema.parse(valor)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const { error } = await supabase
    .from('perfis')
    .upsert({ user_id: user.id, contribuir_capas: contribuir }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)

  revalidatePath('/configuracoes')
  return contribuir
}

export async function definirContribuirCapas(valor: boolean) {
  return executar(() => definirContribuirCapasImpl(valor))
}
