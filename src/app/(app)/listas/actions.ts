'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'
import { lancarErroRpc } from '@/lib/rpc'
import { limiteComentarios } from '@/lib/limite-taxa'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { escaparLike } from '@/lib/like'
import { MAX_COMENTARIO } from '@/lib/feed'
import { carregarComentariosDaLista, listaInputSchema, notaDoItemSchema } from '@/lib/listas'
import type { TipoObra } from '@/lib/types'

const idSchema = z.string().uuid()

async function contexto() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')
  return { supabase, userId: user.id }
}

function atualizarTelas(lista?: string) {
  revalidatePath('/listas')
  if (lista) revalidatePath(`/listas/${lista}`)
}

async function criarListaImpl(entrada: unknown) {
  const dados = listaInputSchema.parse(entrada)
  const { supabase } = await contexto()
  const { data, error } = await supabase.rpc('lista_salvar', {
    p_id: null,
    p_titulo: dados.titulo,
    p_descricao: dados.descricao ?? null,
    p_ordenada: dados.ordenada,
    p_tipo: dados.tipo ?? null,
  })
  if (error) lancarErroRpc(error)
  atualizarTelas()
  return String(data)
}
export async function criarLista(entrada: unknown) {
  return executar(() => criarListaImpl(entrada))
}

async function editarListaImpl(id: string, entrada: unknown) {
  const lista = idSchema.parse(id)
  const dados = listaInputSchema.parse(entrada)
  const { supabase } = await contexto()
  const { error } = await supabase.rpc('lista_salvar', {
    p_id: lista,
    p_titulo: dados.titulo,
    p_descricao: dados.descricao ?? null,
    p_ordenada: dados.ordenada,
    p_tipo: dados.tipo ?? null,
  })
  if (error) lancarErroRpc(error)
  atualizarTelas(lista)
}
export async function editarLista(id: string, entrada: unknown) {
  return executar(() => editarListaImpl(id, entrada))
}

async function apagarListaImpl(id: string) {
  const lista = idSchema.parse(id)
  const { supabase } = await contexto()
  const { error } = await supabase.rpc('lista_apagar', { p_id: lista })
  if (error) lancarErroRpc(error)
  atualizarTelas()
}
export async function apagarLista(id: string) {
  return executar(() => apagarListaImpl(id))
}

async function adicionarItemImpl(lista: string, item: string, nota: string | null, spoiler: boolean) {
  const listaId = idSchema.parse(lista)
  const itemId = idSchema.parse(item)
  const texto = notaDoItemSchema.parse(nota)
  const { supabase } = await contexto()
  const { error } = await supabase.rpc('lista_item_adicionar', { p_lista: listaId, p_item: itemId, p_nota: texto || null, p_spoiler: z.boolean().parse(spoiler) })
  if (error) lancarErroRpc(error)
  atualizarTelas(listaId)
}
export async function adicionarItem(lista: string, item: string, nota: string | null = null, spoiler = false) {
  return executar(() => adicionarItemImpl(lista, item, nota, spoiler))
}

async function editarItemImpl(lista: string, id: string, nota: string | null, spoiler: boolean) {
  const listaId = idSchema.parse(lista)
  const itemId = idSchema.parse(id)
  const texto = notaDoItemSchema.parse(nota)
  const { supabase } = await contexto()
  const { error } = await supabase.rpc('lista_item_editar', { p_id: itemId, p_nota: texto || null, p_spoiler: z.boolean().parse(spoiler) })
  if (error) lancarErroRpc(error)
  atualizarTelas(listaId)
}
export async function editarItem(lista: string, id: string, nota: string | null, spoiler: boolean) {
  return executar(() => editarItemImpl(lista, id, nota, spoiler))
}

async function removerItemImpl(lista: string, id: string) {
  const listaId = idSchema.parse(lista)
  const itemId = idSchema.parse(id)
  const { supabase } = await contexto()
  const { error } = await supabase.rpc('lista_item_remover', { p_id: itemId })
  if (error) lancarErroRpc(error)
  atualizarTelas(listaId)
}
export async function removerItem(lista: string, id: string) {
  return executar(() => removerItemImpl(lista, id))
}

async function reordenarItensImpl(lista: string, ids: string[]) {
  const listaId = idSchema.parse(lista)
  const ordem = z.array(idSchema).max(200).parse(ids)
  const { supabase } = await contexto()
  const { error } = await supabase.rpc('lista_itens_reordenar', { p_lista: listaId, p_ids: ordem })
  if (error) lancarErroRpc(error)
  atualizarTelas(listaId)
}
export async function reordenarItens(lista: string, ids: string[]) {
  return executar(() => reordenarItensImpl(lista, ids))
}

async function alternarCurtidaDaListaImpl(lista: string, curtir: boolean) {
  const id = idSchema.parse(lista)
  const { supabase } = await contexto()
  const { error } = await supabase.rpc(curtir ? 'lista_curtir' : 'lista_descurtir', { p_lista: id })
  if (error) lancarErroRpc(error)
}
export async function alternarCurtidaDaLista(lista: string, curtir: boolean) {
  return executar(() => alternarCurtidaDaListaImpl(lista, curtir))
}

async function comentarNaListaImpl(lista: string, texto: string) {
  const id = idSchema.parse(lista)
  const t = z.string().trim().min(1, 'Escreva alguma coisa para comentar.').max(MAX_COMENTARIO, `O comentário passa de ${MAX_COMENTARIO} caracteres.`).parse(texto)
  const { supabase, userId } = await contexto()
  if (!limiteComentarios.tentar(userId).ok) throw new ErroDeNegocio('Você está comentando rápido demais. Espere um minuto.')
  const { error } = await supabase.rpc('lista_comentar', { p_lista: id, p_texto: t })
  if (error) lancarErroRpc(error)
}
export async function comentarNaLista(lista: string, texto: string) {
  return executar(() => comentarNaListaImpl(lista, texto))
}

async function apagarComentarioDaListaImpl(comentario: string) {
  const id = idSchema.parse(comentario)
  const { supabase } = await contexto()
  const { error } = await supabase.rpc('lista_apagar_comentario', { p_id: id })
  if (error) lancarErroRpc(error)
}
export async function apagarComentarioDaLista(comentario: string) {
  return executar(() => apagarComentarioDaListaImpl(comentario))
}

async function listarComentariosDaListaImpl(lista: string) {
  const id = idSchema.parse(lista)
  const { supabase } = await contexto()
  return carregarComentariosDaLista(supabase, id)
}
export async function listarComentariosDaLista(lista: string) {
  return executar(() => listarComentariosDaListaImpl(lista))
}

export type ItemParaAdicionar = {
  id: string
  titulo: string
  serieNome: string | null
  numeroVolume: number | null
  tipo: TipoObra
  estado: 'desejo' | 'comprado' | 'lido'
  capa: string | null
  /** A obra já está na lista (mesma chave): o botão fica desligado. */
  jaNaLista: boolean
}

/** Busca na PRÓPRIA coleção (a RLS de `itens` já limita ao dono), por título ou nome da série. */
async function buscarItensParaListaImpl(lista: string, termo: string): Promise<ItemParaAdicionar[]> {
  const listaId = idSchema.parse(lista)
  const t = z.string().trim().min(2, 'Digite ao menos 2 letras.').max(80).parse(termo)
  const { supabase, userId } = await contexto()
  const padrao = `%${escaparLike(t)}%`
  const colunas = 'id, titulo, numero_volume, tipo, estado, capa_url, obra_chave, serie:series(nome)'

  const { data: series } = await supabase.from('series').select('id').eq('user_id', userId).ilike('nome', padrao).limit(20)
  const idsSeries = (series ?? []).map((s) => s.id as string)
  const [porTitulo, porSerie, naLista] = await Promise.all([
    supabase.from('itens').select(colunas).eq('user_id', userId).is('variante_de', null).ilike('titulo', padrao).order('titulo').limit(20),
    idsSeries.length > 0
      ? supabase.from('itens').select(colunas).eq('user_id', userId).is('variante_de', null).in('serie_id', idsSeries).order('numero_volume', { nullsFirst: false }).limit(30)
      : Promise.resolve({ data: [] as never[], error: null }),
    supabase.rpc('lista_itens_listar', { p_lista: listaId }),
  ])
  if (porTitulo.error) throw new Error(porTitulo.error.message)

  const chavesNaLista = new Set(((naLista.data ?? []) as { obra_chave: string | null }[]).map((i) => i.obra_chave).filter((c): c is string => Boolean(c)))
  type Linha = { id: string; titulo: string; numero_volume: number | string | null; tipo: TipoObra; estado: ItemParaAdicionar['estado']; capa_url: string | null; obra_chave: string | null; serie: { nome: string } | { nome: string }[] | null }
  const vistos = new Set<string>()
  const linhas = [...((porTitulo.data ?? []) as unknown as Linha[]), ...((porSerie.data ?? []) as unknown as Linha[])].filter((l) => {
    if (vistos.has(l.id)) return false
    vistos.add(l.id)
    return true
  })
  const capas = urlsDeCapas(linhas.map((l) => l.capa_url))
  return linhas.slice(0, 30).map((l) => ({
    id: l.id,
    titulo: l.titulo,
    serieNome: (Array.isArray(l.serie) ? l.serie[0]?.nome : l.serie?.nome) ?? null,
    numeroVolume: l.numero_volume === null ? null : Number(l.numero_volume),
    tipo: l.tipo,
    estado: l.estado,
    capa: l.capa_url ? (capas.get(l.capa_url) ?? null) : null,
    jaNaLista: l.obra_chave !== null && chavesNaLista.has(l.obra_chave),
  }))
}
export async function buscarItensParaLista(lista: string, termo: string) {
  return executar(() => buscarItensParaListaImpl(lista, termo))
}
