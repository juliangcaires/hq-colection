import type { SupabaseClient } from '@supabase/supabase-js'
import { tituloDoPost } from '@/lib/feed'

/**
 * Notificações do app (migration 0033). Só chama as funções `notificacoes_*` do banco, que devolvem ids e nomes:
 * o texto da tela é montado aqui, com o apelido de quem fez e o nome da obra — nunca com nota, crítica nem o
 * texto do comentário (a notificação nem os guarda).
 *
 * Tipo novo: um trigger novo no banco (com o CHECK de `tipo` trocado) + um caso em `textoDaNotificacao`
 * e em `hrefDaNotificacao`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

export const TAMANHO_PAGINA_NOTIFICACOES = 50

export type TipoNotificacao = 'curtida' | 'comentario' | 'amizade_pedido' | 'amizade_aceita'

export type Notificacao = {
  id: string
  /** Texto cru do banco: um tipo que este app ainda não conhece cai no texto genérico. */
  tipo: string
  autorApelido: string | null
  autorNome: string | null
  /** Item do post (curtida/comentário); nulo nos tipos de amizade. */
  itemId: string | null
  serieNome: string | null
  titulo: string | null
  numeroVolume: number | null
  criadoEm: string
  lida: boolean
}

export async function carregarNotificacoes(supabase: Cliente, antes: string | null = null, limite = TAMANHO_PAGINA_NOTIFICACOES): Promise<Notificacao[]> {
  const { data, error } = await supabase.rpc('notificacoes_listar', { p_limite: limite, p_antes: antes })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    tipo: String(r.tipo),
    autorApelido: (r.autor_apelido as string | null) ?? null,
    autorNome: (r.autor_nome as string | null) ?? null,
    itemId: (r.item_id as string | null) ?? null,
    serieNome: (r.serie_nome as string | null) ?? null,
    titulo: (r.titulo as string | null) ?? null,
    numeroVolume: r.numero_volume === null || r.numero_volume === undefined ? null : Number(r.numero_volume),
    criadoEm: String(r.criado_em),
    lida: r.lida === true,
  }))
}

/** Contador do sininho. Qualquer falha (inclusive o banco sem a 0033) vira 0: o sino nunca derruba a tela. */
export async function contarNaoLidas(supabase: Cliente): Promise<number> {
  const { data, error } = await supabase.rpc('notificacoes_contar_nao_lidas')
  if (error) return 0
  const n = Number(data ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Quem fez: nome de exibição, senão o apelido, senão "Alguém". */
export function nomeDoAutor(n: Pick<Notificacao, 'autorNome' | 'autorApelido'>): string {
  return n.autorNome?.trim() || n.autorApelido?.trim() || 'Alguém'
}

/** "Berserk #3" ou só o título; vazio se o aviso não tem item. */
export function obraDaNotificacao(n: Pick<Notificacao, 'serieNome' | 'titulo' | 'numeroVolume'>): string {
  if (!n.titulo) return ''
  return tituloDoPost({ serieNome: n.serieNome, titulo: n.titulo, numeroVolume: n.numeroVolume, qtd: 1 })
}

export function textoDaNotificacao(n: Notificacao): string {
  const quem = nomeDoAutor(n)
  const obra = obraDaNotificacao(n)
  switch (n.tipo) {
    case 'curtida':
      return obra ? `${quem} curtiu sua leitura de ${obra}` : `${quem} curtiu sua leitura`
    case 'comentario':
      return obra ? `${quem} comentou na sua leitura de ${obra}` : `${quem} comentou na sua leitura`
    case 'amizade_pedido':
      return `${quem} enviou um pedido de amizade`
    case 'amizade_aceita':
      return `${quem} aceitou seu pedido de amizade`
    default:
      return 'Você tem uma notificação nova'
  }
}

/** Para onde o toque leva: o feed (onde o post está) ou a tela de Amigos (o perfil, quando há apelido). */
export function hrefDaNotificacao(n: Pick<Notificacao, 'tipo' | 'autorApelido'>): string {
  switch (n.tipo) {
    case 'curtida':
    case 'comentario':
      return '/feed'
    case 'amizade_aceita':
      return n.autorApelido && /^[a-z0-9_-]+$/i.test(n.autorApelido) ? `/amigos/${encodeURIComponent(n.autorApelido)}` : '/amigos'
    case 'amizade_pedido':
      return '/amigos'
    default:
      return '/notificacoes'
  }
}
