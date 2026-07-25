import type { SupabaseClient } from '@supabase/supabase-js'
import type { EstadoItem, ItemComRelacoes, Tag, TipoObra, TipoTag } from '@/lib/types'

const ITEM_SELECT =
  '*, serie:series(id, nome, tipo, em_publicacao, serie_tags(tags(id, nome, tipo, cor, user_id, created_at))), item_tags(tags(id, nome, tipo, cor, user_id, created_at))'

type RawItemRow = {
  id: string
  user_id: string
  serie_id: string | null
  titulo: string
  numero_volume: number | null
  tipo: TipoObra
  isbn: string | null
  estado: EstadoItem
  prioridade: number
  capa_url: string | null
  capa_origem: 'api' | 'foto' | 'nenhuma'
  preco: number | null
  loja: string | null
  data_aquisicao: string | null
  nota: number | null
  observacoes: string | null
  created_at: string
  updated_at: string
  serie: {
    id: string
    nome: string
    tipo: TipoObra
    em_publicacao: boolean
    serie_tags: { tags: Tag | null }[] | null
  } | null
  item_tags: { tags: Tag | null }[] | null
}

function toItemComRelacoes(row: RawItemRow): ItemComRelacoes {
  const tagsDaSerie = (row.serie?.serie_tags ?? []).map((st) => st.tags).filter((t): t is Tag => Boolean(t))
  const tagsDoItem = (row.item_tags ?? []).map((it) => it.tags).filter((t): t is Tag => Boolean(t))
  const map = new Map<string, Tag>()
  for (const tag of [...tagsDoItem, ...tagsDaSerie]) map.set(tag.id, tag)

  return {
    ...row,
    serie: row.serie ? { id: row.serie.id, nome: row.serie.nome, tipo: row.serie.tipo } : null,
    tagsItem: tagsDoItem,
    tagsSerie: tagsDaSerie,
    tagsEfetivas: Array.from(map.values()),
  }
}

export type FiltrosItens = {
  estado?: EstadoItem
  tipo?: TipoObra
  serieId?: string
  busca?: string
  /** Para cada tipo com ids preenchidos: item precisa ter PELO MENOS UMA dessas tags (OR dentro do tipo).
   *  Entre tipos diferentes, todos os filtros preenchidos precisam ser satisfeitos (AND entre tipos). */
  tagsPorTipo?: Partial<Record<TipoTag, string[]>>
}

export async function listarItens(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  filtros: FiltrosItens = {},
  orderBy: { column: string; ascending?: boolean } = { column: 'created_at', ascending: false }
): Promise<ItemComRelacoes[]> {
  let query = supabase.from('itens').select(ITEM_SELECT).order(orderBy.column, {
    ascending: orderBy.ascending ?? false,
  })

  if (filtros.estado) query = query.eq('estado', filtros.estado)
  if (filtros.tipo) query = query.eq('tipo', filtros.tipo)
  if (filtros.serieId) query = query.eq('serie_id', filtros.serieId)
  if (filtros.busca) query = query.ilike('titulo', `%${filtros.busca}%`)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  let itens = ((data ?? []) as unknown as RawItemRow[]).map(toItemComRelacoes)

  if (filtros.tagsPorTipo) {
    for (const ids of Object.values(filtros.tagsPorTipo)) {
      if (!ids || ids.length === 0) continue
      const idSet = new Set(ids)
      itens = itens.filter((i) => i.tagsEfetivas.some((t) => idSet.has(t.id)))
    }
  }

  return itens
}

export async function listarItem(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  id: string
): Promise<ItemComRelacoes | null> {
  const { data, error } = await supabase.from('itens').select(ITEM_SELECT).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return toItemComRelacoes(data as unknown as RawItemRow)
}
