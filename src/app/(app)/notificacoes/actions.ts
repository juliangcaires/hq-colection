'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'
import { lancarErroRpc } from '@/lib/rpc'
import { carregarNotificacoes, contarNaoLidas, TAMANHO_PAGINA_NOTIFICACOES } from '@/lib/notificacoes'

async function contexto() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')
  return { supabase }
}

/** Contador do sininho (consultado pela tela de tempos em tempos). */
export async function contarNotificacoes() {
  return executar(async () => contarNaoLidas((await contexto()).supabase))
}

/** Sem ids, marca todas as da pessoa. Devolve quantas mudaram. */
async function marcarLidasImpl(ids?: string[]) {
  const lista = ids === undefined ? null : z.array(z.string().uuid()).min(1).max(200).parse(ids)
  const { supabase } = await contexto()
  const { data, error } = await supabase.rpc('notificacoes_marcar_lidas', { p_ids: lista })
  if (error) lancarErroRpc(error)
  return Number(data ?? 0)
}
export async function marcarNotificacoesLidas(ids?: string[]) {
  return executar(() => marcarLidasImpl(ids))
}

async function maisNotificacoesImpl(antes: string) {
  const quando = z.string().datetime({ offset: true }).parse(antes)
  const { supabase } = await contexto()
  return carregarNotificacoes(supabase, quando, TAMANHO_PAGINA_NOTIFICACOES)
}
export async function maisNotificacoes(antes: string) {
  return executar(() => maisNotificacoesImpl(antes))
}
