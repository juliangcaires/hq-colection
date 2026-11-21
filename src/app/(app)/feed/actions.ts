'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'
import { lancarErroRpc } from '@/lib/rpc'
import { limiteComentarios } from '@/lib/limite-taxa'
import { dispararPush } from '@/lib/push-servidor'
import { carregarComentarios, carregarFeed, MAX_COMENTARIO, TAMANHO_PAGINA_FEED } from '@/lib/feed'

const idSchema = z.string().uuid()

async function contexto() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')
  return { supabase, userId: user.id }
}

/** Interruptor geral: ligado, toda leitura marcada passa a aparecer para os amigos (e nota/crítica ficam visíveis a eles). */
async function definirFeedAtivoImpl(ativo: boolean) {
  const valor = z.boolean().parse(ativo)
  const { supabase } = await contexto()
  const { error } = await supabase.rpc('feed_configurar', { p_ativo: valor })
  if (error) lancarErroRpc(error)
  revalidatePath('/configuracoes')
  revalidatePath('/feed')
  return valor
}
export async function definirFeedAtivo(ativo: boolean) {
  return executar(() => definirFeedAtivoImpl(ativo))
}

async function alternarCurtidaImpl(item: string, curtir: boolean) {
  const id = idSchema.parse(item)
  const { supabase, userId } = await contexto()
  const { error } = await supabase.rpc(curtir ? 'feed_curtir' : 'feed_descurtir', { p_item: id })
  if (error) lancarErroRpc(error)
  // O banco já criou (ou não) o aviso; o push só sai se ele existe e é novo. Nunca derruba a curtida.
  if (curtir) await dispararPush({ autorId: userId, tipos: ['curtida'], itemId: id })
}
export async function alternarCurtida(item: string, curtir: boolean) {
  return executar(() => alternarCurtidaImpl(item, curtir))
}

async function comentarImpl(item: string, texto: string) {
  const id = idSchema.parse(item)
  const t = z.string().trim().min(1, 'Escreva alguma coisa para comentar.').max(MAX_COMENTARIO, `O comentário passa de ${MAX_COMENTARIO} caracteres.`).parse(texto)
  const { supabase, userId } = await contexto()
  if (!limiteComentarios.tentar(userId).ok) throw new ErroDeNegocio('Você está comentando rápido demais. Espere um minuto.')
  const { data: comentarioId, error } = await supabase.rpc('feed_comentar', { p_item: id, p_texto: t })
  if (error) lancarErroRpc(error)
  if (typeof comentarioId === 'string') await dispararPush({ autorId: userId, tipos: ['comentario'], itemId: id, refId: comentarioId })
}
export async function comentar(item: string, texto: string) {
  return executar(() => comentarImpl(item, texto))
}

async function apagarComentarioImpl(comentario: string) {
  const id = idSchema.parse(comentario)
  const { supabase } = await contexto()
  const { error } = await supabase.rpc('feed_apagar_comentario', { p_id: id })
  if (error) lancarErroRpc(error)
}
export async function apagarComentario(comentario: string) {
  return executar(() => apagarComentarioImpl(comentario))
}

/** O dono tira um dos seus posts do feed (ou devolve). Não mexe em nota nem crítica. */
async function ocultarDoFeedImpl(item: string, oculto: boolean) {
  const id = idSchema.parse(item)
  const { supabase } = await contexto()
  const { error } = await supabase.rpc('feed_ocultar', { p_item: id, p_oculto: z.boolean().parse(oculto) })
  if (error) lancarErroRpc(error)
  revalidatePath('/feed')
}
export async function ocultarDoFeed(item: string, oculto: boolean) {
  return executar(() => ocultarDoFeedImpl(item, oculto))
}

/**
 * "Tirar do feed" a partir do card. Sem `revalidatePath`: a lista na tela já se atualiza sozinha (e mantém as páginas
 * carregadas); quem recoloca pede um `router.refresh()`.
 * Post de vários volumes sai INTEIRO (todos os volumes da série no mesmo dia);
 * devolve os ids que saíram para a tela oferecer "Desfazer" com exatamente eles.
 */
async function tirarPostDoFeedImpl(item: string, grupo: boolean) {
  const id = idSchema.parse(item)
  const { supabase } = await contexto()
  const { data, error } = await supabase.rpc('feed_ocultar_post', { p_item: id, p_grupo: z.boolean().parse(grupo) })
  if (error) lancarErroRpc(error)
  return ((data ?? []) as string[]).map(String)
}
export async function tirarPostDoFeed(item: string, grupo: boolean) {
  return executar(() => tirarPostDoFeedImpl(item, grupo))
}

/** Desfaz o "tirar" ou recoloca no feed: devolve (ou esconde) vários itens do próprio usuário de uma vez. */
async function definirOcultosImpl(itens: string[], oculto: boolean) {
  const ids = z.array(idSchema).min(1).max(500).parse(itens)
  const { supabase } = await contexto()
  const { data, error } = await supabase.rpc('feed_ocultar_varios', { p_itens: ids, p_oculto: z.boolean().parse(oculto) })
  if (error) lancarErroRpc(error)
  return Number(data ?? 0)
}
export async function definirOcultosDoFeed(itens: string[], oculto: boolean) {
  return executar(() => definirOcultosImpl(itens, oculto))
}

async function listarComentariosImpl(item: string) {
  const id = idSchema.parse(item)
  const { supabase } = await contexto()
  return carregarComentarios(supabase, id)
}
export async function listarComentarios(item: string) {
  return executar(() => listarComentariosImpl(item))
}

async function maisPostsImpl(antes: string) {
  const quando = z.string().datetime({ offset: true }).parse(antes)
  const { supabase } = await contexto()
  return carregarFeed(supabase, quando, TAMANHO_PAGINA_FEED)
}
export async function maisPosts(antes: string) {
  return executar(() => maisPostsImpl(antes))
}
