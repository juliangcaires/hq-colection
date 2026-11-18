import type { SupabaseClient } from '@supabase/supabase-js'
import { intervaloDoPeriodo, lerPeriodoDaUrl } from '@/lib/ranking'

/**
 * Ranking dos amigos (migration 0023): a RPC `ranking_amigos` faz a conta (agrupa por obra, aplica a regra de
 * visibilidade e ordena). Aqui ficam a leitura da URL, o rótulo, os avatares empilhados e o mapeamento da resposta.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

export const ORDENS_AMIGOS = ['nota', 'lidos', 'media', 'recentes'] as const
export type OrdemAmigos = (typeof ORDENS_AMIGOS)[number]

export const ROTULOS_ORDEM_AMIGOS: Record<OrdemAmigos, string> = {
  nota: 'Melhor avaliados',
  lidos: 'Mais lidos pelos amigos',
  media: 'Média simples',
  recentes: 'Mais recentes',
}

export const REGRA_DA_ORDEM =
  'A ordem considera quantos amigos leram: poucas notas pesam menos, então 1 voto 5★ não passa na frente de 4 votos com média 4,75. A média mostrada é a real. Em caso de empate, vem primeiro o volume que mais amigos elegeram o melhor da série.'

/** Valor neutro de C quando nenhum amigo avaliou nada; igual ao da migration 0023. */
export const MEDIA_PADRAO = 3.5
export const PESO_DA_MEDIA = 1

/** Média suavizada `(soma + m·C) / (n + m)`: a mesma conta da RPC; só ordena, nunca é exibida como nota. */
export function pontuacaoSuavizada(soma: number, n: number, c: number = MEDIA_PADRAO, m: number = PESO_DA_MEDIA): number {
  return (soma + m * c) / (n + m)
}

export type FiltrosAmigos = {
  tipo?: 'hq' | 'manga'
  ordem: OrdemAmigos
  /** `este-ano`, `12m` ou um ano (`2025`); `undefined` = sempre (o padrão). */
  periodo?: string
  soNaoLidos: boolean
}

/** Valores inválidos são ignorados: link digitado errado não derruba a página. */
export function lerFiltrosAmigos(params: Record<string, string | undefined>): FiltrosAmigos {
  return {
    tipo: params.tipo === 'hq' || params.tipo === 'manga' ? params.tipo : undefined,
    ordem: (ORDENS_AMIGOS as readonly string[]).includes(params.ordem ?? '') ? (params.ordem as OrdemAmigos) : 'nota',
    periodo: lerPeriodoDaUrl(params.periodo),
    soNaoLidos: params.nao_li === '1',
  }
}

/** "1 amigo" / "3 amigos". */
export function rotuloDeAmigos(n: number): string {
  return `${n} ${n === 1 ? 'amigo' : 'amigos'}`
}

/** "Melhor da série para 2 amigos" (selo do volume que amigos marcaram, 0030). */
export function rotuloMelhorParaAmigos(n: number): string {
  return `Melhor da série para ${rotuloDeAmigos(n)}`
}

export type AvatarDoRanking = { apelido: string | null; nome: string | null; avatarUrl: string | null }

/** Até 3 avatares e o "+N" dos que ficaram de fora (N conta todos os amigos da linha, não só os avatares recebidos). */
export function avataresEmpilhados(avatares: AvatarDoRanking[], total: number, maximo = 3): { visiveis: AvatarDoRanking[]; extra: number } {
  const visiveis = avatares.slice(0, maximo)
  return { visiveis, extra: Math.max(0, total - visiveis.length) }
}

export type LinhaDoRankingAmigos = {
  /** Chave do grupo (a menor entre as que compartilham ISBN): serve para abrir o painel de notas. */
  obraChave: string
  isbn: string | null
  titulo: string
  numeroVolume: number | null
  serieNome: string | null
  temNumeracao: boolean
  tipo: 'hq' | 'manga'
  n: number
  soma: number
  /** Média real das notas dos amigos (a sua não entra). */
  media: number
  score: number
  /** Quantos amigos (entre os que contam na linha) marcaram este volume como o melhor da série (0030). */
  nMelhor: number
  /** Você marcou o seu volume desta obra como o melhor da série (só vale se você o leu). */
  meuMelhor: boolean
  ultimaLeitura: string | null
  avatares: AvatarDoRanking[]
  minhaNota: number | null
  meuItemId: string | null
  /** Caminho `pub/<hash>.<ext>` de capa do catálogo público. */
  capaPublica: string | null
  /** Item de amigo cuja capa privada o feed já mostra a você (`/feed/capa/[item]`). */
  capaItemId: string | null
}

export type ResultadoDoRankingAmigos = { linhas: LinhaDoRankingAmigos[]; total: number }

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const txt = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

export function linhaDoRankingAmigos(r: Record<string, unknown>): LinhaDoRankingAmigos {
  const avatares = Array.isArray(r.avatares) ? (r.avatares as Record<string, unknown>[]) : []
  return {
    obraChave: String(r.obra_chave ?? ''),
    isbn: txt(r.isbn),
    titulo: String(r.titulo ?? ''),
    numeroVolume: num(r.numero_volume),
    serieNome: txt(r.serie_nome),
    temNumeracao: r.tem_numeracao === true,
    tipo: r.tipo === 'manga' ? 'manga' : 'hq',
    n: Number(r.n ?? 0),
    soma: Number(r.soma ?? 0),
    media: Number(r.media ?? 0),
    score: Number(r.score ?? 0),
    nMelhor: Number(r.n_melhor ?? 0),
    meuMelhor: r.meu_melhor === true,
    ultimaLeitura: txt(r.ultima_leitura),
    avatares: avatares.map((a) => ({ apelido: txt(a.apelido), nome: txt(a.nome_exibicao), avatarUrl: txt(a.avatar_url) })),
    minhaNota: num(r.minha_nota),
    meuItemId: txt(r.meu_item_id),
    capaPublica: txt(r.capa_publica),
    capaItemId: txt(r.capa_item_id),
  }
}

export async function carregarRankingAmigos(supabase: Cliente, filtros: FiltrosAmigos, limite: number, hoje: Date = new Date()): Promise<ResultadoDoRankingAmigos> {
  const intervalo = intervaloDoPeriodo(filtros.periodo, hoje)
  const { data, error } = await supabase.rpc('ranking_amigos', {
    p_tipo: filtros.tipo ?? null,
    p_desde: intervalo?.desde ?? null,
    p_ate: intervalo?.ate ?? null,
    p_ordem: filtros.ordem,
    p_so_nao_lidos: filtros.soNaoLidos,
    p_limite: limite,
    p_offset: 0,
  })
  if (error) throw new Error(error.message)
  const brutas = (data ?? []) as Record<string, unknown>[]
  return { linhas: brutas.map(linhaDoRankingAmigos), total: brutas.length > 0 ? Number(brutas[0].total) : 0 }
}

export type EstadoDosAmigos = { amigos: number; amigosComNotas: number }

export async function carregarEstadoDosAmigos(supabase: Cliente): Promise<EstadoDosAmigos> {
  const { data, error } = await supabase.rpc('ranking_amigos_estado')
  if (error) throw new Error(error.message)
  const r = ((data ?? []) as Record<string, unknown>[])[0] ?? {}
  return { amigos: Number(r.amigos ?? 0), amigosComNotas: Number(r.amigos_com_notas ?? 0) }
}

export type SituacaoVazia = 'sem-amigos' | 'sem-escopo' | 'sem-notas' | 'sem-resultado' | null

/** Qual aviso mostrar quando a lista vem vazia (ou `null` se há linhas). Os filtros só explicam o vazio se existirem. */
export function situacaoVazia(estado: EstadoDosAmigos, linhas: number, filtrando: boolean): SituacaoVazia {
  if (linhas > 0) return null
  if (estado.amigos === 0) return 'sem-amigos'
  if (estado.amigosComNotas === 0) return 'sem-escopo'
  return filtrando ? 'sem-resultado' : 'sem-notas'
}

/** Anos para o seletor de período: do atual até 5 antes, mais o ano pedido na URL se ficou de fora. */
export function anosParaPeriodo(hoje: Date, selecionado?: string): number[] {
  const atual = hoje.getFullYear()
  const anos = Array.from({ length: 6 }, (_, i) => atual - i)
  const pedido = selecionado && /^\d{4}$/.test(selecionado) ? Number(selecionado) : null
  if (pedido && !anos.includes(pedido)) anos.push(pedido)
  return anos.sort((a, b) => b - a)
}
