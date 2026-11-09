import type { SupabaseClient } from '@supabase/supabase-js'
import { urlPublicaDeCapa } from '@/lib/supabase/capas'
import type { SecaoCompartilhavel } from '@/lib/compartilhamento'
import type { EstadoItem, TipoObra } from '@/lib/types'

/**
 * Leitura da coleção de outra pessoa: pelo link público (token) ou como amigo aceito (apelido).
 * As duas fontes chamam funções com o mesmo formato de resposta (`link_*` e `amigo_*`, migrations 0013/0014),
 * então as telas são as mesmas. Nada aqui consulta as tabelas direto: só as funções que o banco expõe.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

export type FonteVitrine = { tipo: 'link'; token: string } | { tipo: 'amigo'; apelido: string }
export type SecaoVitrine = 'colecao' | 'lidos' | 'desejos' | 'ranking' | 'serie'

export type ResumoVitrine = {
  nome: string
  apelido: string | null
  escopo: SecaoCompartilhavel[]
  colecao: number | null
  lidos: number | null
  desejos: number | null
  series: number | null
}

export type ItemVitrine = {
  id: string
  titulo: string
  serie_id: string | null
  serie_nome: string | null
  numero_volume: number | null
  tipo: TipoObra
  estado: EstadoItem
  /** `pub/<hash>.<ext>` (catálogo público) ou só o nome do arquivo (capa privada do dono); null sem capa. */
  capa: string | null
  nota: number | null
  critica: string | null
  lido_em: string | null
  isbn13: string | null
  reservado: boolean
  reservado_por_mim: boolean
}

export type SerieVitrine = {
  id: string
  nome: string
  tipo: TipoObra
  total_volumes: number | null
  possuidos: number
  lidos: number | null
  nota: number | null
  critica: string | null
  capa: string | null
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

function rpc(fonte: FonteVitrine, nome: 'resumo' | 'itens' | 'series' | 'capa'): string {
  return `${fonte.tipo === 'link' ? 'link' : 'amigo'}_${nome}`
}

function identificador(fonte: FonteVitrine): Record<string, string> {
  return fonte.tipo === 'link' ? { p_token: fonte.token } : { p_apelido: fonte.apelido }
}

/** Caminho base das páginas desta fonte (`/c/<token>` ou `/amigos/<apelido>`). */
export function baseDaFonte(fonte: FonteVitrine): string {
  return fonte.tipo === 'link' ? `/c/${fonte.token}` : `/amigos/${encodeURIComponent(fonte.apelido)}`
}

export async function carregarResumo(supabase: Cliente, fonte: FonteVitrine): Promise<ResumoVitrine | null> {
  const { data, error } = await supabase.rpc(rpc(fonte, 'resumo'), identificador(fonte))
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    nome: String(r.nome ?? 'Colecionador'),
    apelido: (r.apelido as string | null) ?? null,
    escopo: (r.escopo as SecaoCompartilhavel[]) ?? [],
    colecao: num(r.colecao),
    lidos: num(r.lidos),
    desejos: num(r.desejos),
    series: num(r.series),
  }
}

export async function carregarItens(
  supabase: Cliente,
  fonte: FonteVitrine,
  secao: SecaoVitrine,
  { serie = null, limite = 60, offset = 0 }: { serie?: string | null; limite?: number; offset?: number } = {}
): Promise<{ itens: ItemVitrine[]; total: number }> {
  const { data, error } = await supabase.rpc(rpc(fonte, 'itens'), {
    ...identificador(fonte),
    p_secao: secao,
    p_serie: serie,
    p_limite: limite,
    p_offset: offset,
  })
  if (error) throw new Error(error.message)
  const linhas = (data ?? []) as (Record<string, unknown> & { total: number | string })[]
  return {
    total: linhas.length > 0 ? Number(linhas[0].total) : 0,
    itens: linhas.map((l) => ({
      id: String(l.id),
      titulo: String(l.titulo),
      serie_id: (l.serie_id as string | null) ?? null,
      serie_nome: (l.serie_nome as string | null) ?? null,
      numero_volume: num(l.numero_volume),
      tipo: l.tipo as TipoObra,
      estado: l.estado as EstadoItem,
      capa: (l.capa as string | null) ?? null,
      nota: num(l.nota),
      critica: (l.critica as string | null) ?? null,
      lido_em: (l.lido_em as string | null) ?? null,
      isbn13: (l.isbn13 as string | null) ?? null,
      reservado: l.reservado === true,
      reservado_por_mim: l.reservado_por_mim === true,
    })),
  }
}

export async function carregarSeries(supabase: Cliente, fonte: FonteVitrine, serie: string | null = null): Promise<SerieVitrine[]> {
  const { data, error } = await supabase.rpc(rpc(fonte, 'series'), { ...identificador(fonte), p_serie: serie })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((s) => ({
    id: String(s.id),
    nome: String(s.nome),
    tipo: s.tipo as TipoObra,
    total_volumes: num(s.total_volumes),
    possuidos: Number(s.possuidos ?? 0),
    lidos: num(s.lidos),
    nota: num(s.nota),
    critica: (s.critica as string | null) ?? null,
    capa: (s.capa as string | null) ?? null,
  }))
}

/** Arquivo de capa privada válido (nome gerado pelo app); o resto nunca vai ao banco nem ao Storage. */
export const ARQUIVO_DE_CAPA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-\d{10,16})?\.(jpg|png|webp)$/

/** URL da capa para quem está vendo: catálogo público direto do bucket; privada pela rota desta fonte. */
export function urlDeCapaDaVitrine(fonte: FonteVitrine, capa: string | null): string | null {
  if (!capa) return null
  if (capa.startsWith('pub/')) return urlPublicaDeCapa(capa) || null
  if (!ARQUIVO_DE_CAPA.test(capa)) return null
  return `${baseDaFonte(fonte)}/capa/${capa}`
}

/** Rótulo de volume na grade: "#3" só quando há número. */
export function rotuloDeVolume(numero: number | null): string {
  return numero === null ? '' : `#${Number.isInteger(numero) ? numero : String(numero).replace('.', ',')}`
}
