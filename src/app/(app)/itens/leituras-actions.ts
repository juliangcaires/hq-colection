'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'
import { lancarErroRpc } from '@/lib/rpc'
import { FUSO_DO_APP, hojeIso } from '@/lib/datas'
import { alvoDasLeituras, validarDataDeLeitura } from '@/lib/leituras'

const idSchema = z.string().uuid()

function revalidar(itemId: string) {
  revalidatePath(`/item/${itemId}`)
  revalidatePath('/diario')
  revalidatePath('/feed')
  revalidatePath('/ranking')
  revalidatePath('/colecao')
  revalidatePath('/')
}

async function contexto() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')
  return { supabase, userId: user.id }
}

/** Já existe uma leitura nessa data? (duas no mesmo dia quase sempre são um toque duplo.) */
async function jaTemNaData(supabase: Awaited<ReturnType<typeof createClient>>, itemId: string, data: string, exceto?: string) {
  let q = supabase.from('leituras').select('id').eq('item_id', itemId).eq('lido_em', data)
  if (exceto) q = q.neq('id', exceto)
  const { data: achadas, error } = await q.limit(1)
  if (error) throw new Error(error.message)
  return (achadas ?? []).length > 0
}

/** "Reli": registra uma nova leitura (hoje, se a data não vier). Vale para o volume normal quando o item é variante. */
async function adicionarLeituraImpl(itemId: string, data?: string) {
  const id = idSchema.parse(itemId)
  const { supabase, userId } = await contexto()
  const dia = validarDataDeLeitura(data || hojeIso(FUSO_DO_APP), hojeIso(FUSO_DO_APP))
  const alvo = await alvoDasLeituras(supabase, id)
  if (alvo.estado !== 'lido') throw new ErroDeNegocio('Só dá para registrar leitura de um volume marcado como lido.')
  if (await jaTemNaData(supabase, alvo.id, dia)) throw new ErroDeNegocio('Já existe uma leitura nessa data.')
  const { error } = await supabase.from('leituras').insert({ item_id: alvo.id, user_id: userId, lido_em: dia })
  if (error) lancarErroRpc(error)
  revalidar(id)
  revalidar(alvo.id)
}
export async function adicionarLeitura(itemId: string, data?: string) {
  return executar(() => adicionarLeituraImpl(itemId, data))
}

async function editarLeituraImpl(itemId: string, leituraId: string, data: string) {
  const id = idSchema.parse(itemId)
  const lid = idSchema.parse(leituraId)
  const { supabase } = await contexto()
  const dia = validarDataDeLeitura(data, hojeIso(FUSO_DO_APP))
  const alvo = await alvoDasLeituras(supabase, id)
  if (await jaTemNaData(supabase, alvo.id, dia, lid)) throw new ErroDeNegocio('Já existe uma leitura nessa data.')
  const { data: feitas, error } = await supabase.from('leituras').update({ lido_em: dia }).eq('id', lid).eq('item_id', alvo.id).select('id')
  if (error) lancarErroRpc(error)
  if (!feitas || feitas.length === 0) throw new ErroDeNegocio('Leitura não encontrada.')
  revalidar(id)
  revalidar(alvo.id)
}
export async function editarLeitura(itemId: string, leituraId: string, data: string) {
  return executar(() => editarLeituraImpl(itemId, leituraId, data))
}

async function removerLeituraImpl(itemId: string, leituraId: string) {
  const id = idSchema.parse(itemId)
  const lid = idSchema.parse(leituraId)
  const { supabase } = await contexto()
  const alvo = await alvoDasLeituras(supabase, id)
  const { data: feitas, error } = await supabase.from('leituras').delete().eq('id', lid).eq('item_id', alvo.id).select('id')
  if (error) lancarErroRpc(error)
  if (!feitas || feitas.length === 0) throw new ErroDeNegocio('Leitura não encontrada.')
  revalidar(id)
  revalidar(alvo.id)
}
export async function removerLeitura(itemId: string, leituraId: string) {
  return executar(() => removerLeituraImpl(itemId, leituraId))
}
