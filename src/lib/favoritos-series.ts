import type { SupabaseClient } from '@supabase/supabase-js'
import { urlDeCapaDaVitrine, type FonteVitrine } from '@/lib/vitrine'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { normalizarTexto } from '@/lib/texto'
import type { TipoObra } from '@/lib/types'

/**
 * Até 4 séries favoritas no perfil (migration 0026). O banco garante o limite e a posição; aqui ficam as
 * regras da tela (adicionar, remover, reordenar, buscar) como funções puras, e a leitura das funções SQL.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

export const LIMITE_FAVORITOS = 4

/** Série favorita pronta para a tela: `capa` já é uma URL (ou null, sem capa). */
export type FavoritoSerie = {
  id: string
  nome: string
  tipo: TipoObra
  capa: string | null
}

/** Série que dá para escolher (da própria coleção). */
export type SerieCandidata = FavoritoSerie

/** Cabem mais favoritos? */
export function podeAdicionar(favoritos: readonly { id: string }[], id?: string): boolean {
  if (id !== undefined && favoritos.some((f) => f.id === id)) return false
  return favoritos.length < LIMITE_FAVORITOS
}

/** Põe a série no fim da lista; devolve a mesma lista se já está lá ou se já são 4. */
export function adicionarFavorito<T extends { id: string }>(favoritos: readonly T[], serie: T): T[] {
  if (!podeAdicionar(favoritos, serie.id)) return [...favoritos]
  return [...favoritos, serie]
}

export function removerFavorito<T extends { id: string }>(favoritos: readonly T[], id: string): T[] {
  return favoritos.filter((f) => f.id !== id)
}

/** Sobe (-1) ou desce (+1) uma série na lista; nas pontas, não muda nada. */
export function moverFavorito<T extends { id: string }>(favoritos: readonly T[], id: string, delta: -1 | 1): T[] {
  const de = favoritos.findIndex((f) => f.id === id)
  const para = de + delta
  if (de < 0 || para < 0 || para >= favoritos.length) return [...favoritos]
  const copia = [...favoritos]
  ;[copia[de], copia[para]] = [copia[para], copia[de]]
  return copia
}

/** Busca simples por nome, sem acento nem maiúsculas; sem termo, tudo. Quem já é favorito fica de fora. */
export function buscarCandidatas<T extends { id: string; nome: string }>(candidatas: readonly T[], termo: string, jaEscolhidas: readonly { id: string }[] = []): T[] {
  const alvo = normalizarTexto(termo)
  const usadas = new Set(jaEscolhidas.map((f) => f.id))
  return candidatas.filter((c) => !usadas.has(c.id) && (alvo === '' || normalizarTexto(c.nome).includes(alvo)))
}

type Linha = { id: unknown; nome: unknown; tipo: unknown; capa: unknown; posicao?: unknown }

function ordenadas(linhas: Linha[]): Linha[] {
  return [...linhas].sort((a, b) => Number(a.posicao ?? 0) - Number(b.posicao ?? 0))
}

/** Favoritos de um amigo ou do link: `capa` vem no formato da vitrine (`pub/…` ou só o arquivo do dono). */
export function favoritosDaVitrine(linhas: Linha[] | null | undefined, fonte: FonteVitrine): FavoritoSerie[] {
  return ordenadas(linhas ?? [])
    .slice(0, LIMITE_FAVORITOS)
    .map((l) => ({
      id: String(l.id),
      nome: String(l.nome),
      tipo: l.tipo as TipoObra,
      capa: urlDeCapaDaVitrine(fonte, (l.capa as string | null) ?? null),
    }))
}

/** Favoritos/candidatas do próprio usuário: `capa` é o caminho completo (`itens.capa_url`). */
export function seriesDoDono(linhas: Linha[] | null | undefined): FavoritoSerie[] {
  const lista = ordenadas(linhas ?? [])
  const urls = urlsDeCapas(lista.map((l) => (l.capa as string | null) ?? null))
  return lista.map((l) => ({
    id: String(l.id),
    nome: String(l.nome),
    tipo: l.tipo as TipoObra,
    capa: (typeof l.capa === 'string' ? urls.get(l.capa) : undefined) ?? null,
  }))
}

/** Os favoritos de um amigo aceito. Sem amizade, sem a seção "séries" ou sem favoritos: lista vazia. */
export async function carregarFavoritosDoAmigo(supabase: Cliente, apelido: string): Promise<FavoritoSerie[]> {
  const { data, error } = await supabase.rpc('amigo_favoritos_series', { p_apelido: apelido })
  if (error) throw new Error(error.message)
  return favoritosDaVitrine(data as Linha[] | null, { tipo: 'amigo', apelido })
}

export async function carregarMeusFavoritos(supabase: Cliente): Promise<FavoritoSerie[]> {
  const { data, error } = await supabase.rpc('favoritos_series_meus')
  if (error) throw new Error(error.message)
  return seriesDoDono(data as Linha[] | null)
}

export async function carregarCandidatas(supabase: Cliente): Promise<SerieCandidata[]> {
  const { data, error } = await supabase.rpc('favoritos_series_candidatas')
  if (error) throw new Error(error.message)
  return seriesDoDono(data as Linha[] | null)
}

