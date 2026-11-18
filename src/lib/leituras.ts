import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ErroDeNegocio } from '@/lib/resultado'

/**
 * Leituras de um volume (migration 0025): uma nota e uma crítica por volume, várias datas de leitura.
 * `itens.lido_em` é a mais recente e o banco a mantém; aqui só se escreve em `leituras`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

export type LeituraDoItem = {
  id: string
  /** AAAA-MM-DD */
  lidoEm: string
  /** Segunda leitura em diante (pela ordem das datas). */
  releitura: boolean
}

export const dataDeLeituraSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')

/** A data é real (30/02 não existe) e não está no futuro (`hoje` = AAAA-MM-DD no fuso do app). */
export function validarDataDeLeitura(data: string, hoje: string): string {
  const d = dataDeLeituraSchema.parse(data)
  const t = new Date(`${d}T00:00:00Z`)
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d) throw new ErroDeNegocio('Data inválida.')
  if (d > hoje) throw new ErroDeNegocio('A leitura não pode ser no futuro.')
  return d
}

/**
 * Ordena e marca quais leituras são releitura: a primeira de cada volume (menor data; empate pelo registro e id)
 * é a leitura original, as outras são releituras. Devolve da mais recente para a mais antiga.
 */
export function marcarReleituras<T extends { id: string; item_id?: string; lido_em: string; criado_em?: string }>(
  linhas: T[]
): (T & { releitura: boolean })[] {
  const cronologica = (a: T, b: T) =>
    a.lido_em.localeCompare(b.lido_em) || (a.criado_em ?? '').localeCompare(b.criado_em ?? '') || a.id.localeCompare(b.id)
  const primeira = new Map<string, string>()
  for (const l of [...linhas].sort(cronologica)) {
    const chave = l.item_id ?? ''
    if (!primeira.has(chave)) primeira.set(chave, l.id)
  }
  return [...linhas]
    .sort((a, b) => -cronologica(a, b))
    .map((l) => ({ ...l, releitura: primeira.get(l.item_id ?? '') !== l.id }))
}

/**
 * Volume em que as leituras ficam. Variante (0017) divide o estado com o volume normal e não tem leituras próprias:
 * enquanto o principal não for desejo, vale o principal.
 */
export async function alvoDasLeituras(supabase: Cliente, itemId: string): Promise<{ id: string; estado: string }> {
  const { data: item, error } = await supabase.from('itens').select('id, estado, variante_de').eq('id', itemId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!item) throw new ErroDeNegocio('Item não encontrado')
  if (item.variante_de) {
    const { data: principal } = await supabase.from('itens').select('id, estado').eq('id', item.variante_de).maybeSingle()
    if (principal && principal.estado !== 'desejo') return { id: principal.id as string, estado: principal.estado as string }
  }
  return { id: item.id as string, estado: item.estado as string }
}

export async function carregarLeituras(supabase: Cliente, itemId: string): Promise<LeituraDoItem[]> {
  const alvo = await alvoDasLeituras(supabase, itemId)
  const { data, error } = await supabase.from('leituras').select('id, item_id, lido_em, criado_em').eq('item_id', alvo.id)
  if (error) throw new Error(error.message)
  return marcarReleituras((data ?? []) as { id: string; item_id: string; lido_em: string; criado_em: string }[]).map((l) => ({
    id: l.id,
    lidoEm: l.lido_em,
    releitura: l.releitura,
  }))
}
