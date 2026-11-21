'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'

const assinaturaSchema = z.object({
  endpoint: z.string().max(2048).startsWith('https://', 'Endereço de push inválido'),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
})
const preferenciasSchema = z.object({ curtidas: z.boolean(), comentarios: z.boolean(), amizades: z.boolean() })

async function contexto() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')
  return { supabase }
}

/** Guarda a assinatura deste aparelho (a que o navegador gerou depois da permissão). */
async function salvarAssinaturaImpl(assinatura: unknown) {
  const a = assinaturaSchema.parse(assinatura)
  const { supabase } = await contexto()
  const userAgent = (await headers()).get('user-agent')
  const { error } = await supabase.rpc('push_assinar', { p_endpoint: a.endpoint, p_p256dh: a.keys.p256dh, p_auth: a.keys.auth, p_user_agent: userAgent })
  if (error) throw new Error(error.message)
}
export async function salvarAssinaturaPush(assinatura: unknown) {
  return executar(() => salvarAssinaturaImpl(assinatura))
}

async function removerAssinaturaImpl(endpoint: string) {
  const e = z.string().max(2048).parse(endpoint)
  const { supabase } = await contexto()
  const { error } = await supabase.rpc('push_desassinar', { p_endpoint: e })
  if (error) throw new Error(error.message)
}
export async function removerAssinaturaPush(endpoint: string) {
  return executar(() => removerAssinaturaImpl(endpoint))
}

async function definirPreferenciasImpl(prefs: unknown) {
  const p = preferenciasSchema.parse(prefs)
  const { supabase } = await contexto()
  const { error } = await supabase.rpc('push_preferencias_definir', { p_curtidas: p.curtidas, p_comentarios: p.comentarios, p_amizades: p.amizades })
  if (error) throw new Error(error.message)
}
export async function definirPreferenciasPush(prefs: unknown) {
  return executar(() => definirPreferenciasImpl(prefs))
}
