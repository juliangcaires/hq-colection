'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'
import { apelidoSchema, escopoSchema, nomeExibicaoSchema } from '@/lib/compartilhamento'
import { lancarErroRpc } from '@/lib/rpc'

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

/** Apelido (único) e nome de exibição: é como amigos e quem abre o link enxergam você. */
async function salvarPerfilImpl(input: { apelido: string; nome_exibicao: string }) {
  const apelido = apelidoSchema.parse(input.apelido)
  const nome = nomeExibicaoSchema.parse(input.nome_exibicao)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const { error } = await supabase
    .from('perfis')
    .upsert({ user_id: user.id, apelido, nome_exibicao: nome || null }, { onConflict: 'user_id' })
  if (error) {
    if (error.code === '23505') throw new ErroDeNegocio('Esse apelido já está em uso. Escolha outro.')
    throw new Error(error.message)
  }
  revalidatePath('/configuracoes')
  return { apelido }
}

export async function salvarPerfil(input: { apelido: string; nome_exibicao: string }) {
  return executar(() => salvarPerfilImpl(input))
}

/** Gera um link novo (o anterior, se houver, deixa de valer na hora) com as seções escolhidas. */
async function gerarLinkImpl(escopo: string[]) {
  const e = escopoSchema.parse(escopo)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('compartilhamento_gerar', { p_escopo: e })
  if (error) lancarErroRpc(error)
  revalidatePath('/configuracoes')
  return data as string
}

export async function gerarLink(escopo: string[]) {
  return executar(() => gerarLinkImpl(escopo))
}

async function revogarLinkImpl() {
  const supabase = await createClient()
  const { error } = await supabase.rpc('compartilhamento_revogar')
  if (error) lancarErroRpc(error)
  revalidatePath('/configuracoes')
}

export async function revogarLink() {
  return executar(() => revogarLinkImpl())
}

async function atualizarEscopoDoLinkImpl(escopo: string[]) {
  const e = escopoSchema.parse(escopo)
  const supabase = await createClient()
  const { error } = await supabase.rpc('compartilhamento_escopo_atualizar', { p_escopo: e })
  if (error) lancarErroRpc(error)
  revalidatePath('/configuracoes')
}

export async function atualizarEscopoDoLink(escopo: string[]) {
  return executar(() => atualizarEscopoDoLinkImpl(escopo))
}
