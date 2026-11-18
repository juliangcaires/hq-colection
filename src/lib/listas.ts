import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { urlPublicaDeCapa } from '@/lib/supabase/capas'
import { ARQUIVO_DE_CAPA, rotuloDeVolume } from '@/lib/vitrine'
import type { ComentarioDoFeed } from '@/lib/feed'
import type { TipoObra } from '@/lib/types'

/**
 * Listas curadas para amigos (migration 0028). Só chama as funções `lista_*` do banco, que decidem quem vê o quê
 * (o dono e amigos aceitos; nunca o link público); nada aqui consulta as tabelas direto.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

export const MAX_TITULO_LISTA = 80
export const MAX_DESCRICAO_LISTA = 500
export const MAX_NOTA_DO_ITEM = 300
export const MAX_ITENS_DA_LISTA = 200

export const TIPOS_DE_LISTA = ['ordem_leitura', 'arco', 'melhores', 'emprestar', 'outro'] as const
export type TipoDeLista = (typeof TIPOS_DE_LISTA)[number]

export const ROTULOS_TIPO_DE_LISTA: Record<TipoDeLista, string> = {
  ordem_leitura: 'Ordem de leitura',
  arco: 'Arco',
  melhores: 'Melhores',
  emprestar: 'Para emprestar',
  outro: 'Outra',
}

export const listaInputSchema = z.object({
  titulo: z.string().trim().min(1, 'Dê um título para a lista.').max(MAX_TITULO_LISTA, `O título passa de ${MAX_TITULO_LISTA} caracteres.`),
  descricao: z.string().trim().max(MAX_DESCRICAO_LISTA, `A descrição passa de ${MAX_DESCRICAO_LISTA} caracteres.`).optional().nullable(),
  ordenada: z.boolean(),
  tipo: z.enum(TIPOS_DE_LISTA).optional().nullable(),
})
export type ListaInput = z.infer<typeof listaInputSchema>

export const notaDoItemSchema = z.string().trim().max(MAX_NOTA_DO_ITEM, `O comentário passa de ${MAX_NOTA_DO_ITEM} caracteres.`).optional().nullable()

export type DonoDaLista = {
  donoId: string
  apelido: string | null
  nome: string | null
  avatarUrl: string | null
  proprio: boolean
}

export type ResumoDeLista = DonoDaLista & {
  id: string
  titulo: string
  descricao: string | null
  ordenada: boolean
  tipo: TipoDeLista | null
  qtd: number
  /** `pub/<hash>` ou nome de arquivo privado; só serve para saber se há capa (a URL sai do item). */
  capa: string | null
  capaItem: string | null
  curtidas: number
  curti: boolean
  comentarios: number
  atualizadaEm: string
}

export type DetalheDaLista = Omit<ResumoDeLista, 'capa' | 'capaItem'>

export type ItemDaLista = {
  id: string
  posicao: number
  obraChave: string | null
  titulo: string
  serieNome: string | null
  numeroVolume: number | null
  tipo: TipoObra
  capa: string | null
  nota: string | null
  spoiler: boolean
  /** Você tem esta obra (algum volume na sua coleção, fora desejo). */
  tenho: boolean
  /** Você já leu. */
  li: boolean
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const texto = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const tipoDeLista = (v: unknown): TipoDeLista | null => ((TIPOS_DE_LISTA as readonly string[]).includes(v as string) ? (v as TipoDeLista) : null)

function dono(r: Record<string, unknown>): DonoDaLista {
  return { donoId: String(r.dono_id), apelido: texto(r.apelido), nome: texto(r.nome_exibicao), avatarUrl: texto(r.avatar_url), proprio: r.proprio === true }
}

function detalhe(r: Record<string, unknown>): DetalheDaLista {
  return {
    ...dono(r),
    id: String(r.id),
    titulo: String(r.titulo),
    descricao: texto(r.descricao),
    ordenada: r.ordenada === true,
    tipo: tipoDeLista(r.tipo),
    qtd: Number(r.qtd ?? 0),
    curtidas: Number(r.curtidas ?? 0),
    curti: r.curti === true,
    comentarios: Number(r.comentarios ?? 0),
    atualizadaEm: String(r.atualizada_em),
  }
}

/** Minhas listas e as dos amigos (ou só as de um amigo, por apelido). */
export async function carregarListas(supabase: Cliente, apelido: string | null = null): Promise<ResumoDeLista[]> {
  const { data, error } = await supabase.rpc('listas_listar', { p_apelido: apelido })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...detalhe(r), capa: texto(r.capa), capaItem: texto(r.capa_item) }))
}

/** Uma lista; null se não existe ou você não pode ver (a página vira 404, sem distinguir os casos). */
export async function carregarLista(supabase: Cliente, id: string): Promise<DetalheDaLista | null> {
  const { data, error } = await supabase.rpc('lista_detalhe', { p_lista: id })
  if (error) throw new Error(error.message)
  const r = ((data ?? []) as Record<string, unknown>[])[0]
  return r ? detalhe(r) : null
}

export async function carregarItensDaLista(supabase: Cliente, id: string): Promise<ItemDaLista[]> {
  const { data, error } = await supabase.rpc('lista_itens_listar', { p_lista: id })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    posicao: Number(r.posicao),
    obraChave: texto(r.obra_chave),
    titulo: String(r.titulo),
    serieNome: texto(r.serie_nome),
    numeroVolume: num(r.numero_volume),
    tipo: (r.tipo as TipoObra) ?? 'hq',
    capa: texto(r.capa),
    nota: texto(r.nota),
    spoiler: r.spoiler === true,
    tenho: r.tenho === true,
    li: r.li === true,
  }))
}

export async function carregarComentariosDaLista(supabase: Cliente, id: string): Promise<ComentarioDoFeed[]> {
  const { data, error } = await supabase.rpc('lista_comentarios_listar', { p_lista: id })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    apelido: texto(r.apelido),
    nome: texto(r.nome_exibicao),
    avatarUrl: texto(r.avatar_url),
    texto: String(r.texto),
    criadoEm: String(r.criado_em),
    meu: r.meu === true,
    podeApagar: r.pode_apagar === true,
  }))
}

/**
 * URL da capa de um item de lista: catálogo público direto do bucket; privada pela rota `/listas/capa/[item]`, que só
 * serve o arquivo se o banco autorizar (dono ou amigo aceito).
 */
export function urlDeCapaDaLista(capa: string | null, itemId: string | null): string | null {
  if (!capa || !itemId) return null
  if (capa.startsWith('pub/')) return urlPublicaDeCapa(capa) || null
  if (!ARQUIVO_DE_CAPA.test(capa)) return null
  return `/listas/capa/${itemId}`
}

/** "Berserk #3" / só o título quando não há série ou o título já traz o número. */
export function tituloDoItemDaLista(item: Pick<ItemDaLista, 'serieNome' | 'titulo' | 'numeroVolume'>): string {
  const vol = rotuloDeVolume(item.numeroVolume)
  if (item.serieNome && vol && !item.titulo.includes(vol)) return `${item.serieNome} ${vol}`
  return item.titulo
}

/** "1 item" / "12 itens" / "vazia". */
export function rotuloDeItens(qtd: number): string {
  if (qtd === 0) return 'vazia'
  return `${qtd} ${qtd === 1 ? 'item' : 'itens'}`
}

/** Situação do item para quem vê: "Lido", "Tenho" ou "Não tenho". */
export function situacaoDoItem(item: Pick<ItemDaLista, 'tenho' | 'li'>): 'lido' | 'tenho' | 'nao_tenho' {
  if (item.li) return 'lido'
  return item.tenho ? 'tenho' : 'nao_tenho'
}

/** Quantos itens da lista você tem e quantos leu (para o resumo "Você leu 3 de 8"). */
export function resumoDaSituacao(itens: Pick<ItemDaLista, 'tenho' | 'li'>[]): { total: number; tenho: number; li: number } {
  return { total: itens.length, tenho: itens.filter((i) => i.tenho).length, li: itens.filter((i) => i.li).length }
}

/**
 * Move o item `de` para a posição `para` (índices de 0 a n-1). Fora do intervalo ou sem mudança, devolve a mesma ordem.
 * Devolve uma lista nova; nunca altera a recebida.
 */
export function moverItem<T>(itens: readonly T[], de: number, para: number): T[] {
  const copia = [...itens]
  if (de === para || de < 0 || para < 0 || de >= copia.length || para >= copia.length) return copia
  const [item] = copia.splice(de, 1)
  copia.splice(para, 0, item)
  return copia
}
