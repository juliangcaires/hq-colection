import type { SupabaseClient } from '@supabase/supabase-js'
import type { EstadoItem, ItemComRelacoes, Tag, TipoObra, TipoTag } from '@/lib/types'
import { calcularVolumesFaltantes, type VolumeParaFuros } from '@/lib/volumes'
import { lerTodasAsLinhas, TAMANHO_PAGINA } from '@/lib/paginar'
import { escaparLike } from '@/lib/like'

const ITEM_SELECT =
  '*, serie:series(id, nome, tipo, em_publicacao, tem_numeracao, serie_tags(tags(id, nome, tipo, cor, user_id, created_at))), item_tags(tags(id, nome, tipo, cor, user_id, created_at))'

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
    tem_numeracao: boolean
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
    serie: row.serie
      ? {
          id: row.serie.id,
          nome: row.serie.nome,
          tipo: row.serie.tipo,
          // `Boolean(...)` porque a coluna é nova: numa base sem a migration vem undefined.
          tem_numeracao: Boolean(row.serie.tem_numeracao),
        }
      : null,
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
  semCapa?: boolean
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
  // `id` desempata a ordenação: sem isso, `.range()` pode repetir/perder linhas entre páginas.
  const data = await lerTodasAsLinhas((de, ate) => {
    let query = supabase
      .from('itens')
      .select(ITEM_SELECT)
      .order(orderBy.column, { ascending: orderBy.ascending ?? false })
      .order('id')

    if (filtros.estado) query = query.eq('estado', filtros.estado)
    if (filtros.tipo) query = query.eq('tipo', filtros.tipo)
    if (filtros.serieId) query = query.eq('serie_id', filtros.serieId)
    if (filtros.busca) query = query.ilike('titulo', `%${escaparLike(filtros.busca)}%`)
    if (filtros.semCapa) query = query.is('capa_url', null)

    return query.range(de, ate)
  })

  let itens = (data as unknown as RawItemRow[]).map(toItemComRelacoes)

  if (filtros.tagsPorTipo) {
    for (const ids of Object.values(filtros.tagsPorTipo)) {
      if (!ids || ids.length === 0) continue
      const idSet = new Set(ids)
      itens = itens.filter((i) => i.tagsEfetivas.some((t) => idSet.has(t.id)))
    }
  }

  return itens
}

/** O que um card de item precisa — sem tags, observações, preço etc. (o payload da lista era 1,1 MB). */
export type ItemDeLista = Pick<
  ItemComRelacoes,
  'id' | 'titulo' | 'estado' | 'prioridade' | 'numero_volume' | 'capa_url' | 'serie'
>

const CARD_SELECT =
  'id, titulo, estado, prioridade, numero_volume, capa_url, serie:series(id, nome, tipo, tem_numeracao)'

/** Itens por chamada no `.in('id', …)` — URL do PostgREST tem limite de tamanho. */
const IDS_POR_CONSULTA = 100

type FiltroBase = Omit<FiltrosItens, 'tagsPorTipo'>

// O builder do PostgREST tem um tipo genérico enorme (estoura o compilador ao encadear); aqui só se aplicam filtros.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aplicarFiltros(query: any, f: FiltroBase): any {
  let q = query
  if (f.estado) q = q.eq('estado', f.estado)
  if (f.tipo) q = q.eq('tipo', f.tipo)
  if (f.serieId) q = q.eq('serie_id', f.serieId)
  if (f.busca) q = q.ilike('titulo', `%${escaparLike(f.busca)}%`)
  if (f.semCapa) q = q.is('capa_url', null)
  return q
}

/**
 * Uma "página" da lista: os primeiros `limite` itens (a tela pede mais com "carregar mais"),
 * só com os campos do card, e o total que casa com os filtros.
 *
 * Sem filtro de tag a paginação é no banco. Com filtro de tag (as tags do item MAIS as da série),
 * primeiro descobre-se quais itens casam — varrendo só `id`, `serie_id` e `item_tags` — e só
 * depois buscam-se os cards desses ids.
 */
export async function listarItensPagina(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  filtros: FiltrosItens = {},
  orderBy: { column: string; ascending?: boolean } = { column: 'created_at', ascending: false },
  limite = 60
): Promise<{ itens: ItemDeLista[]; total: number }> {
  const ascending = orderBy.ascending ?? false
  const grupos = Object.values(filtros.tagsPorTipo ?? {}).filter(
    (ids): ids is string[] => Array.isArray(ids) && ids.length > 0
  )

  if (grupos.length === 0) {
    // O PostgREST devolve no máximo 1000 linhas por consulta; acima disso busca em blocos.
    const itens: ItemDeLista[] = []
    let total = 0
    for (let de = 0; de < limite; de += TAMANHO_PAGINA) {
      const ate = Math.min(de + TAMANHO_PAGINA, limite) - 1
      const { data, error, count } = await aplicarFiltros(
        supabase.from('itens').select(CARD_SELECT, { count: 'exact' }),
        filtros
      )
        .order(orderBy.column, { ascending })
        .order('id')
        .range(de, ate)
      if (error) throw new Error(error.message)
      total = count ?? 0
      itens.push(...((data ?? []) as unknown as ItemDeLista[]))
      if ((data ?? []).length < ate - de + 1) break
    }
    return { itens, total }
  }

  const [candidatos, vinculosDeSerie] = await Promise.all([
    lerTodasAsLinhas<{ id: string; serie_id: string | null; item_tags: { tag_id: string }[] | null }>((de, ate) =>
      aplicarFiltros(supabase.from('itens').select('id, serie_id, item_tags(tag_id)'), filtros)
        .order(orderBy.column, { ascending })
        .order('id')
        .range(de, ate)
    ),
    lerTodasAsLinhas<{ serie_id: string; tag_id: string }>((de, ate) =>
      supabase.from('serie_tags').select('serie_id, tag_id').order('serie_id').order('tag_id').range(de, ate)
    ),
  ])

  const tagsDaSerie = new Map<string, Set<string>>()
  for (const { serie_id, tag_id } of vinculosDeSerie) {
    const atual = tagsDaSerie.get(serie_id) ?? new Set<string>()
    atual.add(tag_id)
    tagsDaSerie.set(serie_id, atual)
  }

  const casam = candidatos.filter((c) => {
    const efetivas = new Set((c.item_tags ?? []).map((t) => t.tag_id))
    if (c.serie_id) for (const t of tagsDaSerie.get(c.serie_id) ?? []) efetivas.add(t)
    return grupos.every((grupo) => grupo.some((id) => efetivas.has(id)))
  })

  const idsDaPagina = casam.slice(0, limite).map((c) => c.id)
  const blocos: string[][] = []
  for (let i = 0; i < idsDaPagina.length; i += IDS_POR_CONSULTA) blocos.push(idsDaPagina.slice(i, i + IDS_POR_CONSULTA))
  const respostas = await Promise.all(
    blocos.map((ids) => supabase.from('itens').select(CARD_SELECT).in('id', ids))
  )
  const porId = new Map<string, ItemDeLista>()
  for (const { data, error } of respostas) {
    if (error) throw new Error(error.message)
    for (const item of (data ?? []) as unknown as ItemDeLista[]) porId.set(item.id, item)
  }

  return {
    itens: idsDaPagina.map((id) => porId.get(id)).filter((i): i is ItemDeLista => Boolean(i)),
    total: casam.length,
  }
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

export type ItemRecente = {
  id: string
  titulo: string
  tipo: TipoObra
  estado: EstadoItem
  created_at: string
  serie: { id: string; nome: string } | null
}

/** Últimos itens adicionados à coleção (por created_at), para o dashboard. Consulta leve, sem tags/capa. */
export async function listarUltimosItens(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  limite = 5
): Promise<ItemRecente[]> {
  const { data, error } = await supabase
    .from('itens')
    .select('id, titulo, tipo, estado, created_at, serie:series(id, nome)')
    .order('created_at', { ascending: false })
    .limit(limite)

  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ItemRecente[]
}

export type SerieComFuros = {
  id: string
  nome: string
  tipo: TipoObra
  faltantes: number[]
}

/**
 * Indexa por série o resultado de uma consulta rasa de volumes
 * (`select('serie_id, numero_volume, estado')`), que é como o dashboard e a
 * tela de Séries evitam N+1: uma consulta só para todos os itens, agrupada aqui.
 */
export function agruparVolumesPorSerie(
  itens: ({ serie_id: string } & VolumeParaFuros)[]
): Map<string, VolumeParaFuros[]> {
  const porSerie = new Map<string, VolumeParaFuros[]>()
  for (const item of itens) {
    const lista = porSerie.get(item.serie_id) ?? []
    lista.push({ numero_volume: item.numero_volume, estado: item.estado })
    porSerie.set(item.serie_id, lista)
  }
  return porSerie
}

/**
 * Séries do usuário que têm furos (volumes faltantes), para o atalho "o que
 * comprar a seguir" do dashboard. Duas consultas leves (sem tags/capa) — sem
 * N+1: busca todas as séries e todos os itens com serie_id de uma vez e
 * agrupa em memória, reaproveitando `calcularVolumesFaltantes`.
 */
export async function listarSeriesComFuros(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  limite = 5
): Promise<SerieComFuros[]> {
  const [series, itens] = await Promise.all([
    lerTodasAsLinhas((de, ate) =>
      supabase.from('series').select('id, nome, tipo, total_volumes').order('id').range(de, ate)
    ),
    // `estado` entra porque volume em `desejo` não conta como possuído no cálculo de furos.
    lerTodasAsLinhas((de, ate) =>
      supabase
        .from('itens')
        .select('serie_id, numero_volume, estado')
        .not('serie_id', 'is', null)
        .order('id')
        .range(de, ate)
    ),
  ])

  const volumesPorSerie = agruparVolumesPorSerie(
    itens as ({ serie_id: string } & VolumeParaFuros)[]
  )

  const resultado: SerieComFuros[] = []
  for (const serie of series as {
    id: string
    nome: string
    tipo: TipoObra
    total_volumes: number | null
  }[]) {
    const faltantes = calcularVolumesFaltantes(volumesPorSerie.get(serie.id) ?? [], serie.total_volumes)
    if (faltantes.length > 0) {
      resultado.push({ id: serie.id, nome: serie.nome, tipo: serie.tipo, faltantes })
    }
  }

  resultado.sort((a, b) => a.faltantes.length - b.faltantes.length)
  return resultado.slice(0, limite)
}
