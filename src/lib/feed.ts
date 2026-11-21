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
  /** Post de vários volumes (0031): média das notas visíveis dos volumes e quantos têm nota. */
  notaMedia: number | null
  avaliados: number
  /** A crítica visível mais recente entre os volumes do post, o volume dela e se é spoiler. */
  criticaGrupo: string | null
  criticaGrupoSpoiler: boolean
  criticaGrupoVolume: number | null
  /** Nota e crítica da série como um todo (0031). */
  serieNota: number | null
  serieCritica: string | null
  /**
   * Post de vários volumes (0032): capa do volume marcado como melhor da série e o item de onde ela vem. Nulos sem melhor
   * volume no post (ou sem a migration): vale `capa`/`itemId`.
   */
  capaDestaque: string | null
  capaDestaqueItem: string | null
}

/** Item tirado do feed que ainda pode voltar (0031): um por post original (série + dia). */
export type OcultoDoFeed = {
  /** Todos os itens do post: é o que "Recolocar" devolve. */
  itemIds: string[]
  serieNome: string | null
  titulo: string
  numeroVolume: number | null
  qtd: number
  marcadoEm: string
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
    notaMedia: num(r.nota_media),
    avaliados: Number(r.avaliados ?? 0),
    criticaGrupo: (r.critica_grupo as string | null) ?? null,
    criticaGrupoSpoiler: r.critica_grupo_spoiler === true,
    criticaGrupoVolume: num(r.critica_grupo_volume),
    serieNota: num(r.serie_nota),
    serieCritica: (r.serie_critica as string | null) ?? null,
    capaDestaque: (r.capa_destaque as string | null) ?? null,
    capaDestaqueItem: (r.capa_destaque_item as string | null) ?? null,
  }))
}

export async function carregarOcultos(supabase: Cliente): Promise<OcultoDoFeed[]> {
  const { data, error } = await supabase.rpc('feed_ocultos_listar')
  // A lista dos tirados é um extra (0031): se a migration ainda não foi aplicada, o feed abre sem ela.
  if (error) return []
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    itemIds: Array.isArray(r.item_ids) ? (r.item_ids as unknown[]).map(String) : [],
    serieNome: (r.serie_nome as string | null) ?? null,
    titulo: String(r.titulo),
    numeroVolume: num(r.numero_volume),
    qtd: Number(r.qtd ?? 1),
    marcadoEm: String(r.marcado_em),
  }))
}

export type AvaliacaoDoPost = {
  nota: number | null
  /** De onde vem a nota: o volume (post de um só), a série ou a média dos volumes. */
  rotuloNota: string | null
  critica: string | null
  rotuloCritica: string | null
  spoiler: boolean
}

/**
 * Nota e crítica que o card mostra. Post de um volume: as do volume. Post de vários: a nota/crítica da série, se
 * houver; senão a média dos volumes avaliados e a crítica mais recente entre eles (dizendo de qual volume).
 * Antes da 0031 o card de vários volumes escondia tudo e a avaliação dada ao marcar a série "sumia".
 */
export function avaliacaoDoPost(
  post: Pick<PostDoFeed, 'qtd' | 'nota' | 'critica' | 'criticaSpoiler' | 'notaMedia' | 'avaliados' | 'criticaGrupo' | 'criticaGrupoSpoiler' | 'criticaGrupoVolume' | 'serieNota' | 'serieCritica'>
): AvaliacaoDoPost {
  if (post.qtd <= 1) {
    return { nota: post.nota, rotuloNota: null, critica: post.critica, rotuloCritica: null, spoiler: post.criticaSpoiler }
  }
  let nota: number | null = null
  let rotuloNota: string | null = null
  if (post.serieNota !== null) {
    nota = post.serieNota
    rotuloNota = 'Nota da série'
  } else if (post.notaMedia !== null && post.avaliados > 0) {
    nota = post.notaMedia
    rotuloNota = post.avaliados === 1 ? 'Nota de 1 volume' : `Média de ${post.avaliados} volumes`
  }
  if (post.serieCritica) {
    return { nota, rotuloNota, critica: post.serieCritica, rotuloCritica: 'Crítica da série', spoiler: false }
  }
  if (post.criticaGrupo) {
    const vol = rotuloDeVolume(post.criticaGrupoVolume)
    return { nota, rotuloNota, critica: post.criticaGrupo, rotuloCritica: vol ? `Crítica do volume ${vol}` : 'Crítica de um volume', spoiler: post.criticaGrupoSpoiler }
  }
  return { nota, rotuloNota, critica: null, rotuloCritica: null, spoiler: false }
}

/** Título de um post tirado do feed (mesma regra do card). */
export function tituloDoOculto(o: Pick<OcultoDoFeed, 'serieNome' | 'titulo' | 'numeroVolume' | 'qtd'>): string {
  return tituloDoPost(o)
}

/** Coloca o post de volta na lista na posição certa (a lista vem ordenada do mais recente para o mais antigo). */
export function reinserirPost(posts: PostDoFeed[], post: PostDoFeed): PostDoFeed[] {
  if (posts.some((p) => chaveDoPost(p) === chaveDoPost(post))) return posts
  const i = posts.findIndex((p) => new Date(p.marcadoEm).getTime() < new Date(post.marcadoEm).getTime())
  const lista = [...posts]
  lista.splice(i === -1 ? lista.length : i, 0, post)
  return lista
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

/**
 * Capa de um post: catálogo público direto do bucket; privada pela rota autorizada pelo banco. Post de vários volumes
 * com melhor volume (0032) usa a capa dele, pedida pelo id dele; senão, a do volume que representa o post.
 */
export function urlDeCapaDoFeed(post: Pick<PostDoFeed, 'capa' | 'itemId'> & Partial<Pick<PostDoFeed, 'capaDestaque' | 'capaDestaqueItem'>>): string | null {
  const destaque = post.capaDestaque && post.capaDestaqueItem
  const capa = destaque ? post.capaDestaque! : post.capa
  const item = destaque ? post.capaDestaqueItem! : post.itemId
  if (!capa) return null
  if (capa.startsWith('pub/')) return urlPublicaDeCapa(capa) || null
  if (!ARQUIVO_DE_CAPA.test(capa)) return null
  return `/feed/capa/${item}`
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
