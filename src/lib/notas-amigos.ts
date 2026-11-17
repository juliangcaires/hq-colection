import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Notas e críticas dos amigos para a mesma obra/série (migration 0019). Só chama `obra_amigos` e `serie_amigos`,
 * que decidem quem vê o quê (amizade aceita, escopo `notas_criticas`, crítica privada nunca sai).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

export type AvaliacaoDeAmigo = {
  /** Item do amigo: alvo de curtidas e comentários. Null nas séries. */
  itemId: string | null
  apelido: string | null
  nome: string | null
  avatarUrl: string | null
  nota: number | null
  critica: string | null
  lidoEm: string | null
  /** 'isbn' = mesmo ISBN; 'nome' = mesmo nome e volume. */
  casouPor: 'isbn' | 'nome' | null
  interagivel: boolean
  curtidas: number
  curti: boolean
  comentarios: number
}

export type MediaDosAmigos = { media: number; qtd: number }

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/** Média só das notas presentes (arredondada a 1 casa); null se ninguém avaliou. */
export function mediaDosAmigos(avaliacoes: Pick<AvaliacaoDeAmigo, 'nota'>[]): MediaDosAmigos | null {
  const notas = avaliacoes.map((a) => a.nota).filter((n): n is number => n !== null)
  if (notas.length === 0) return null
  return { media: Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 10) / 10, qtd: notas.length }
}

export async function carregarObraAmigos(supabase: Cliente, obraChave: string | null, isbn: string | null): Promise<AvaliacaoDeAmigo[]> {
  if (!obraChave) return []
  const { data, error } = await supabase.rpc('obra_amigos', { p_obra_chave: obraChave, p_isbn: isbn || null })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    itemId: String(r.item_id),
    apelido: (r.apelido as string | null) ?? null,
    nome: (r.nome_exibicao as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    nota: num(r.nota),
    critica: (r.critica as string | null) ?? null,
    lidoEm: (r.lido_em as string | null) ?? null,
    casouPor: r.casou_por === 'isbn' ? 'isbn' : 'nome',
    interagivel: r.interagivel === true,
    curtidas: Number(r.curtidas ?? 0),
    curti: r.curti === true,
    comentarios: Number(r.comentarios ?? 0),
  }))
}

export async function carregarSerieAmigos(supabase: Cliente, serieChave: string | null): Promise<AvaliacaoDeAmigo[]> {
  if (!serieChave) return []
  const { data, error } = await supabase.rpc('serie_amigos', { p_serie_chave: serieChave })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    itemId: null,
    apelido: (r.apelido as string | null) ?? null,
    nome: (r.nome_exibicao as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    nota: num(r.nota),
    critica: (r.critica as string | null) ?? null,
    lidoEm: null,
    casouPor: null,
    interagivel: false,
    curtidas: 0,
    curti: false,
    comentarios: 0,
  }))
}
