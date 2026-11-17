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
  /** 'isbn' = mesmo ISBN; 'nome' = mesmo nome e volume; 'manual' = vínculo feito por quem está vendo (0020). */
  casouPor: 'isbn' | 'nome' | 'manual' | null
  interagivel: boolean
  curtidas: number
  curti: boolean
  comentarios: number
}

export type MediaDosAmigos = { media: number; qtd: number }

/** Motivo do casamento como aparece na tela. */
export function rotuloCasouPor(c: AvaliacaoDeAmigo['casouPor']): string | null {
  if (c === 'isbn') return 'mesmo ISBN'
  if (c === 'nome') return 'mesmo nome e volume'
  if (c === 'manual') return 'vínculo manual'
  return null
}

export function casouPorDe(v: unknown): 'isbn' | 'nome' | 'manual' {
  return v === 'isbn' ? 'isbn' : v === 'manual' ? 'manual' : 'nome'
}

export type ObraDeAmigo = {
  obraChave: string
  apelido: string | null
  nome: string | null
  titulo: string
  numeroVolume: number | null
  serieNome: string | null
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/** Média só das notas presentes (arredondada a 1 casa); null se ninguém avaliou. */
export function mediaDosAmigos(avaliacoes: Pick<AvaliacaoDeAmigo, 'nota'>[]): MediaDosAmigos | null {
  const notas = avaliacoes.map((a) => a.nota).filter((n): n is number => n !== null)
  if (notas.length === 0) return null
  return { media: Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 10) / 10, qtd: notas.length }
}

export async function carregarObraAmigos(supabase: Cliente, obraChave: string | null, isbn: string | null): Promise<AvaliacaoDeAmigo[]> {
  // Sem chave ainda dá para casar pelo ISBN (0020).
  if (!obraChave && !isbn) return []
  const { data, error } = await supabase.rpc('obra_amigos', { p_obra_chave: obraChave ?? '', p_isbn: isbn || null })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    itemId: String(r.item_id),
    apelido: (r.apelido as string | null) ?? null,
    nome: (r.nome_exibicao as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    nota: num(r.nota),
    critica: (r.critica as string | null) ?? null,
    lidoEm: (r.lido_em as string | null) ?? null,
    casouPor: casouPorDe(r.casou_por),
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

const obraDeAmigo = (r: Record<string, unknown>): ObraDeAmigo => ({
  obraChave: String(r.obra_chave ?? r.obra_chave_amigo),
  apelido: (r.apelido as string | null) ?? null,
  nome: (r.nome_exibicao as string | null) ?? null,
  titulo: (r.titulo as string | null) ?? '',
  numeroVolume: num(r.numero_volume),
  serieNome: (r.serie_nome as string | null) ?? null,
})

/** Vínculos manuais do usuário para a obra dele (com o item do amigo, se ainda visível). */
export async function carregarEquivalencias(supabase: Cliente, obraChave: string | null): Promise<(ObraDeAmigo & { disponivel: boolean })[]> {
  if (!obraChave) return []
  const { data, error } = await supabase.rpc('obra_equivalencias_listar', { p_obra_chave: obraChave })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...obraDeAmigo(r), disponivel: r.titulo !== null && r.titulo !== undefined }))
}

/** Rótulo curto de uma obra de amigo: "Série #3 — Título (@apelido)". */
export function rotuloObraDeAmigo(o: ObraDeAmigo): string {
  const vol = o.numeroVolume === null ? '' : ` #${o.numeroVolume}`
  const base = o.serieNome ? `${o.serieNome}${vol}${o.titulo && o.titulo !== o.serieNome ? ` — ${o.titulo}` : ''}` : `${o.titulo}${vol}`
  return o.apelido ? `${base} (@${o.apelido})` : base
}
