import type { SupabaseClient } from '@supabase/supabase-js'
import { urlDeCapaDaVitrine, type FonteVitrine } from '@/lib/vitrine'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { normalizarTexto } from '@/lib/texto'
import type { TipoObra } from '@/lib/types'

/**
 * Até 4 favoritos no perfil: séries e volumes únicos (avulsos), no mesmo limite (migrations 0026 e 0036). O banco
 * garante o limite, a posição e quem pode ver; aqui ficam as regras da tela (adicionar, remover, reordenar,
 * buscar) como funções puras, e a leitura das funções SQL.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

export const LIMITE_FAVORITOS = 4

/** `serie` é uma série da coleção; `avulso` é um volume único (item sem série). */
export type OrigemFavorito = 'serie' | 'avulso'

/** Favorito pronto para a tela: `nome` é o da série ou o título do volume; `capa` já é uma URL (ou null, sem capa). */
export type Favorito = {
  origem: OrigemFavorito
  id: string
  nome: string
  tipo: TipoObra
  capa: string | null
}

/** O que dá para escolher (da própria coleção): séries com volume possuído e volumes únicos possuídos. */
export type FavoritoCandidato = Favorito

export const ROTULO_DA_ORIGEM: Record<OrigemFavorito, string> = { serie: 'Série', avulso: 'Volume único' }

/** Item da lista que `favoritos_salvar` recebe (o `tipo` é o do banco: `serie` ou `item`). */
export type FavoritoParaSalvar = { tipo: 'serie' | 'item'; id: string }

export function paraSalvar(favoritos: readonly Pick<Favorito, 'origem' | 'id'>[]): FavoritoParaSalvar[] {
  return favoritos.map((f) => ({ tipo: f.origem === 'avulso' ? 'item' : 'serie', id: f.id }))
}

/** Cabem mais favoritos? */
export function podeAdicionar(favoritos: readonly { id: string }[], id?: string): boolean {
  if (id !== undefined && favoritos.some((f) => f.id === id)) return false
  return favoritos.length < LIMITE_FAVORITOS
}

/** Põe o favorito no fim da lista; devolve a mesma lista se já está lá ou se já são 4. */
export function adicionarFavorito<T extends { id: string }>(favoritos: readonly T[], novo: T): T[] {
  if (!podeAdicionar(favoritos, novo.id)) return [...favoritos]
  return [...favoritos, novo]
}

export function removerFavorito<T extends { id: string }>(favoritos: readonly T[], id: string): T[] {
  return favoritos.filter((f) => f.id !== id)
}

/** Sobe (-1) ou desce (+1) um favorito na lista; nas pontas, não muda nada. */
export function moverFavorito<T extends { id: string }>(favoritos: readonly T[], id: string, delta: -1 | 1): T[] {
  const de = favoritos.findIndex((f) => f.id === id)
  const para = de + delta
  if (de < 0 || para < 0 || para >= favoritos.length) return [...favoritos]
  const copia = [...favoritos]
  ;[copia[de], copia[para]] = [copia[para], copia[de]]
  return copia
}

/** Busca simples por nome (da série ou título do volume), sem acento nem maiúsculas; sem termo, tudo. Quem já é favorito fica de fora. */
export function buscarCandidatas<T extends { id: string; nome: string }>(candidatas: readonly T[], termo: string, jaEscolhidas: readonly { id: string }[] = []): T[] {
  const alvo = normalizarTexto(termo)
  const usadas = new Set(jaEscolhidas.map((f) => f.id))
  return candidatas.filter((c) => !usadas.has(c.id) && (alvo === '' || normalizarTexto(c.nome).includes(alvo)))
}

type Linha = { origem?: unknown; id: unknown; nome: unknown; tipo: unknown; capa: unknown; posicao?: unknown }

// Sem `origem` (função antiga da 0026) é série.
const origemDe = (l: Linha): OrigemFavorito => (l.origem === 'avulso' ? 'avulso' : 'serie')

function ordenadas(linhas: Linha[]): Linha[] {
  return [...linhas].sort((a, b) => Number(a.posicao ?? 0) - Number(b.posicao ?? 0))
}

/** Favoritos de um amigo ou do link: `capa` vem no formato da vitrine (`pub/…` ou só o arquivo do dono). */
export function favoritosDaVitrine(linhas: Linha[] | null | undefined, fonte: FonteVitrine): Favorito[] {
  return ordenadas(linhas ?? [])
    .slice(0, LIMITE_FAVORITOS)
    .map((l) => ({
      origem: origemDe(l),
      id: String(l.id),
      nome: String(l.nome),
      tipo: l.tipo as TipoObra,
      capa: urlDeCapaDaVitrine(fonte, (l.capa as string | null) ?? null),
    }))
}

/** Favoritos/candidatos do próprio usuário: `capa` é o caminho completo (`itens.capa_url`). */
export function favoritosDoDono(linhas: Linha[] | null | undefined): Favorito[] {
  const lista = ordenadas(linhas ?? [])
  const urls = urlsDeCapas(lista.map((l) => (l.capa as string | null) ?? null))
  return lista.map((l) => ({
    origem: origemDe(l),
    id: String(l.id),
    nome: String(l.nome),
    tipo: l.tipo as TipoObra,
    capa: (typeof l.capa === 'string' ? urls.get(l.capa) : undefined) ?? null,
  }))
}

/** Os favoritos de um amigo aceito. Sem amizade ou sem favoritos visíveis (série pede "séries"; avulso pede "coleção"): vazio. */
export async function carregarFavoritosDoAmigo(supabase: Cliente, apelido: string): Promise<Favorito[]> {
  const { data, error } = await supabase.rpc('amigo_favoritos', { p_apelido: apelido })
  if (error) throw new Error(error.message)
  return favoritosDaVitrine(data as Linha[] | null, { tipo: 'amigo', apelido })
}

export async function carregarMeusFavoritos(supabase: Cliente): Promise<Favorito[]> {
  const { data, error } = await supabase.rpc('favoritos_meus')
  if (error) throw new Error(error.message)
  return favoritosDoDono(data as Linha[] | null)
}

export async function carregarCandidatos(supabase: Cliente): Promise<FavoritoCandidato[]> {
  const { data, error } = await supabase.rpc('favoritos_candidatos')
  if (error) throw new Error(error.message)
  return favoritosDoDono(data as Linha[] | null)
}

