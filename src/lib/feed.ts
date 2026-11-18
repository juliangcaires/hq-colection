import type { SupabaseClient } from '@supabase/supabase-js'
import { urlPublicaDeCapa } from '@/lib/supabase/capas'
import { ARQUIVO_DE_CAPA, rotuloDeVolume } from '@/lib/vitrine'
import type { TipoObra } from '@/lib/types'

/**
 * Feed de amigos (migration 0018). Só chama as funções `feed_*` do banco, que decidem quem vê o quê;
 * nada aqui consulta as tabelas direto.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

export const TAMANHO_PAGINA_FEED = 20
export const MAX_COMENTARIO = 500

export type PostDoFeed = {
  /** Item do post (o mais recente, se for um lote): é nele que curtidas e comentários ficam. */
  itemId: string
  apelido: string | null
  nome: string | null
  avatarUrl: string | null
  proprio: boolean
  serieNome: string | null
  titulo: string
  numeroVolume: number | null
  tipo: TipoObra
  /** `pub/<hash>` (catálogo público), nome de arquivo privado ou null. */
  capa: string | null
  nota: number | null
  critica: string | null
  /** A crítica é spoiler (0024): quem não é o autor vê um cartão recolhido. */
  criticaSpoiler: boolean
  lidoEm: string | null
  marcadoEm: string
  /** Quantos volumes do mesmo dia e da mesma série entraram neste post. */
  qtd: number
  curtidas: number
  curti: boolean
  comentarios: number
  /** Post de releitura (0025): "releu X" em vez de "leu X". */
  releitura: boolean
  /** Leitura que originou o post de releitura; null no post de primeira leitura. */
  leituraId: string | null
}

export type ComentarioDoFeed = {
  id: string
  apelido: string | null
  nome: string | null
  avatarUrl: string | null
  texto: string
  criadoEm: string
  meu: boolean
  podeApagar: boolean
}

export type ResumoSemanal = {
  meusLidos: number
  amigos: number
  lidosAmigos: number
  destaque: { titulo: string; numeroVolume: number | null; serie: string | null; apelido: string | null; nota: number } | null
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export async function carregarFeed(supabase: Cliente, antes: string | null = null, limite = TAMANHO_PAGINA_FEED): Promise<PostDoFeed[]> {
  const { data, error } = await supabase.rpc('feed_listar', { p_limite: limite, p_antes: antes })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    itemId: String(r.item_id),
    apelido: (r.apelido as string | null) ?? null,
    nome: (r.nome_exibicao as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    proprio: r.proprio === true,
    serieNome: (r.serie_nome as string | null) ?? null,
    titulo: String(r.titulo),
    numeroVolume: num(r.numero_volume),
    tipo: r.tipo as TipoObra,
    capa: (r.capa as string | null) ?? null,
    nota: num(r.nota),
    critica: (r.critica as string | null) ?? null,
    criticaSpoiler: r.critica_spoiler === true,
    lidoEm: (r.lido_em as string | null) ?? null,
    marcadoEm: String(r.marcado_em),
    qtd: Number(r.qtd ?? 1),
    curtidas: Number(r.curtidas ?? 0),
    curti: r.curti === true,
    comentarios: Number(r.comentarios ?? 0),
    releitura: r.releitura === true,
    leituraId: (r.leitura_id as string | null) ?? null,
  }))
}

export async function carregarComentarios(supabase: Cliente, itemId: string): Promise<ComentarioDoFeed[]> {
  const { data, error } = await supabase.rpc('feed_comentarios_listar', { p_item: itemId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    apelido: (r.apelido as string | null) ?? null,
    nome: (r.nome_exibicao as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    texto: String(r.texto),
    criadoEm: String(r.criado_em),
    meu: r.meu === true,
    podeApagar: r.pode_apagar === true,
  }))
}

export async function carregarResumoSemanal(supabase: Cliente): Promise<ResumoSemanal | null> {
  const { data, error } = await supabase.rpc('feed_resumo_semana')
  if (error) throw new Error(error.message)
  const r = data as Record<string, unknown> | null
  if (!r) return null
  const d = r.destaque as Record<string, unknown> | null
  return {
    meusLidos: Number(r.meus_lidos ?? 0),
    amigos: Number(r.amigos ?? 0),
    lidosAmigos: Number(r.lidos_amigos ?? 0),
    destaque: d
      ? { titulo: String(d.titulo), numeroVolume: num(d.numero_volume), serie: (d.serie as string | null) ?? null, apelido: (d.apelido as string | null) ?? null, nota: Number(d.nota) }
      : null,
  }
}

/** Chave estável de um post: um volume pode ter o "leu" e vários "releu" (um por leitura). */
export function chaveDoPost(post: Pick<PostDoFeed, 'itemId' | 'leituraId'>): string {
  return post.leituraId ? `${post.itemId}:${post.leituraId}` : post.itemId
}

/** Capa de um post: catálogo público direto do bucket; privada pela rota autorizada pelo banco. */
export function urlDeCapaDoFeed(post: Pick<PostDoFeed, 'capa' | 'itemId'>): string | null {
  if (!post.capa) return null
  if (post.capa.startsWith('pub/')) return urlPublicaDeCapa(post.capa) || null
  if (!ARQUIVO_DE_CAPA.test(post.capa)) return null
  return `/feed/capa/${post.itemId}`
}

/** "Berserk #3" / "12 volumes de Berserk" / só o título quando não há série. */
export function tituloDoPost(post: Pick<PostDoFeed, 'serieNome' | 'titulo' | 'numeroVolume' | 'qtd'>): string {
  if (post.qtd > 1) return post.serieNome ? `${post.qtd} volumes de ${post.serieNome}` : `${post.qtd} volumes`
  const vol = rotuloDeVolume(post.numeroVolume)
  if (post.serieNome && vol && !post.titulo.includes(vol)) return `${post.serieNome} ${vol}`
  return post.titulo
}

/** Texto curto do tempo decorrido: "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias" e, depois de 30 dias, a data. */
export function tempoRelativo(iso: string, agora: Date = new Date()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((agora.getTime() - t) / 1000))
  if (s < 60) return 'agora'
  const min = Math.floor(s / 60)
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'ontem'
  if (d < 30) return `há ${d} dias`
  return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Frase do card semanal. */
export function frasesDoResumo(r: ResumoSemanal): string[] {
  const frases = [`Sua semana: ${r.meusLidos} ${r.meusLidos === 1 ? 'volume lido' : 'volumes lidos'}.`]
  if (r.amigos > 0) {
    frases.push(`${r.amigos} ${r.amigos === 1 ? 'amigo leu' : 'amigos leram'} ${r.lidosAmigos} ${r.lidosAmigos === 1 ? 'volume' : 'volumes'}.`)
  }
  return frases
}
