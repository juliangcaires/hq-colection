'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getSignedCapaUrls } from '@/lib/supabase/capas'
import { itensDaSerieSchema, serieInputSchema, type SerieInput } from '@/lib/schemas'
import type { EstadoItem, TipoObra, TipoTag } from '@/lib/types'

export async function createSerie(input: SerieInput) {
  const parsed = serieInputSchema.parse(input)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: serie, error } = await supabase
    .from('series')
    .insert({
      user_id: user.id,
      nome: parsed.nome,
      tipo: parsed.tipo,
      total_volumes: parsed.total_volumes ?? null,
      em_publicacao: parsed.em_publicacao,
      observacoes: parsed.observacoes || null,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  if (parsed.tagIds.length > 0) {
    const rows = parsed.tagIds.map((tag_id) => ({ serie_id: serie.id, tag_id }))
    const { error: tagError } = await supabase.from('serie_tags').insert(rows)
    if (tagError) throw new Error(tagError.message)
  }

  revalidatePath('/colecao')
  revalidatePath('/desejos')
  revalidatePath('/series')
  return serie.id as string
}

export async function updateSerie(id: string, input: SerieInput) {
  const parsed = serieInputSchema.parse(input)
  const supabase = await createClient()

  const { error } = await supabase
    .from('series')
    .update({
      nome: parsed.nome,
      tipo: parsed.tipo,
      total_volumes: parsed.total_volumes ?? null,
      em_publicacao: parsed.em_publicacao,
      observacoes: parsed.observacoes || null,
    })
    .eq('id', id)

  if (error) throw new Error(error.message)

  const { error: clearError } = await supabase.from('serie_tags').delete().eq('serie_id', id)
  if (clearError) throw new Error(clearError.message)

  if (parsed.tagIds.length > 0) {
    const rows = parsed.tagIds.map((tag_id) => ({ serie_id: id, tag_id }))
    const { error: tagError } = await supabase.from('serie_tags').insert(rows)
    if (tagError) throw new Error(tagError.message)
  }

  revalidatePath('/colecao')
  revalidatePath('/desejos')
  revalidatePath('/series')
  revalidatePath(`/serie/${id}`)
}

export async function deleteSerie(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('series').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/colecao')
  revalidatePath('/desejos')
  revalidatePath('/series')
}

type BuscarSerieRow = {
  id: string
  nome: string
  tipo: 'hq' | 'manga'
  total_volumes: number | null
  serie_tags:
    | { tag_id: string; tags: { id: string; nome: string; tipo: TipoTag; cor: string | null } | null }[]
    | null
}

function mapSerieRow(s: BuscarSerieRow) {
  return {
    id: s.id,
    nome: s.nome,
    tipo: s.tipo,
    total_volumes: s.total_volumes,
    tags: (s.serie_tags ?? [])
      .map((st) => st.tags)
      .filter((t): t is NonNullable<typeof t> => Boolean(t)),
  }
}

/** Busca séries por nome; se editoraTagId for informado, restringe às séries com essa tag de editora (cascata). */
export async function buscarSeries(query: string, editoraTagId?: string) {
  const supabase = await createClient()

  if (editoraTagId) {
    const { data, error } = await supabase
      .from('serie_tags')
      .select('series(id, nome, tipo, total_volumes, serie_tags(tag_id, tags(id, nome, tipo, cor)))')
      .eq('tag_id', editoraTagId)
      .limit(200)
    if (error) throw new Error(error.message)

    type Row = { series: BuscarSerieRow | null }
    let series = ((data ?? []) as unknown as Row[])
      .map((r) => r.series)
      .filter((s): s is BuscarSerieRow => Boolean(s))

    if (query.trim()) {
      const q = query.trim().toLowerCase()
      series = series.filter((s) => s.nome.toLowerCase().includes(q))
    }
    series.sort((a, b) => a.nome.localeCompare(b.nome))
    return series.slice(0, 20).map(mapSerieRow)
  }

  let request = supabase
    .from('series')
    .select('id, nome, tipo, total_volumes, serie_tags(tag_id, tags(id, nome, tipo, cor))')
    .order('nome')
    .limit(20)

  if (query.trim()) {
    request = request.ilike('nome', `%${query.trim()}%`)
  }

  const { data, error } = await request
  if (error) throw new Error(error.message)

  return ((data ?? []) as unknown as BuscarSerieRow[]).map(mapSerieRow)
}

/** Teto do seletor de volumes: o app não pagina, então o diálogo não pode puxar a coleção
 *  inteira. Folgado o bastante para caber todos os avulsos de uma coleção real sem truncar. */
const LIMITE_CANDIDATOS = 500

export type ItemCandidato = {
  id: string
  titulo: string
  numero_volume: number | null
  tipo: TipoObra
  estado: EstadoItem
  capaUrl: string | null
  serie: { id: string; nome: string } | null
}

/**
 * Itens da coleção que podem ser agrupados nesta série. Por padrão só os avulsos
 * (`serie_id is null`); com `incluirComSerie`, também os que estão em outra série
 * (que seriam MOVIDOS). Nunca lista os que já pertencem a `serieId`.
 */
export async function buscarItensParaSerie(
  serieId: string,
  query: string,
  incluirComSerie: boolean
): Promise<{ itens: ItemCandidato[]; truncado: boolean }> {
  // Validado antes de entrar na string de filtro do PostgREST logo abaixo.
  const id = z.string().uuid().parse(serieId)
  const supabase = await createClient()

  let request = supabase
    .from('itens')
    .select('id, titulo, numero_volume, tipo, estado, capa_url, serie:series(id, nome)')
    .order('titulo')
    .limit(LIMITE_CANDIDATOS)

  if (incluirComSerie) {
    // `neq` sozinho descartaria os avulsos: em SQL, `NULL <> x` é NULL, não true.
    request = request.or(`serie_id.is.null,serie_id.neq.${id}`)
  } else {
    request = request.is('serie_id', null)
  }

  if (query.trim()) {
    request = request.ilike('titulo', `%${query.trim()}%`)
  }

  const { data, error } = await request
  if (error) throw new Error(error.message)

  type Row = Omit<ItemCandidato, 'capaUrl'> & { capa_url: string | null }
  const rows = (data ?? []) as unknown as Row[]

  const capaMap = await getSignedCapaUrls(
    supabase,
    rows.map((r) => r.capa_url)
  )

  return {
    itens: rows.map(({ capa_url, ...resto }) => ({
      ...resto,
      capaUrl: capaMap.get(capa_url ?? '') ?? null,
    })),
    truncado: rows.length === LIMITE_CANDIDATOS,
  }
}

/** Revalida as listagens + a página de cada série tocada (inclusive as de origem, num movimento). */
function revalidateSeriesEListagens(serieIds: (string | null)[]) {
  revalidatePath('/colecao')
  revalidatePath('/desejos')
  revalidatePath('/')
  revalidatePath('/series')
  for (const id of new Set(serieIds.filter((s): s is string => Boolean(s)))) {
    revalidatePath(`/serie/${id}`)
  }
}

export type ResumoInclusao = {
  incluidos: number
  ignorados: number
  /** Números de volume repetidos dentro da série — não existe unique no banco, só dá para avisar. */
  volumesDuplicados: number[]
}

/** Agrupa vários itens já existentes na coleção sob uma série. Não mexe em `numero_volume`. */
export async function adicionarItensASerie(
  serieId: string,
  itemIds: string[]
): Promise<ResumoInclusao> {
  const parsed = itensDaSerieSchema.parse({ serieId, itemIds })
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: serie, error: serieError } = await supabase
    .from('series')
    .select('id')
    .eq('id', parsed.serieId)
    .maybeSingle()
  if (serieError) throw new Error(serieError.message)
  if (!serie) throw new Error('Série não encontrada')

  // As páginas das séries de origem também ficam desatualizadas quando um volume sai delas.
  const { data: antes, error: antesError } = await supabase
    .from('itens')
    .select('serie_id')
    .in('id', parsed.itemIds)
  if (antesError) throw new Error(antesError.message)
  const seriesDeOrigem = ((antes ?? []) as { serie_id: string | null }[]).map((i) => i.serie_id)

  // Sem `user_id` no update: a RLS `itens_owner` já restringe ao dono (mesmo padrão de updateItem).
  const { data: atualizados, error } = await supabase
    .from('itens')
    .update({ serie_id: parsed.serieId })
    .in('id', parsed.itemIds)
    .select('id')
  if (error) throw new Error(error.message)

  const incluidos = (atualizados ?? []).length

  const { data: volumes, error: volumesError } = await supabase
    .from('itens')
    .select('numero_volume')
    .eq('serie_id', parsed.serieId)
    .not('numero_volume', 'is', null)
  if (volumesError) throw new Error(volumesError.message)

  const vistos = new Set<number>()
  const duplicados = new Set<number>()
  for (const { numero_volume } of (volumes ?? []) as { numero_volume: number }[]) {
    if (vistos.has(numero_volume)) duplicados.add(numero_volume)
    else vistos.add(numero_volume)
  }

  revalidateSeriesEListagens([parsed.serieId, ...seriesDeOrigem])

  return {
    incluidos,
    ignorados: parsed.itemIds.length - incluidos,
    volumesDuplicados: Array.from(duplicados).sort((a, b) => a - b),
  }
}

/** Desvincula itens da série — eles voltam a ser avulsos, sem serem excluídos. */
export async function removerItensDaSerie(serieId: string, itemIds: string[]): Promise<number> {
  const parsed = itensDaSerieSchema.parse({ serieId, itemIds })
  const supabase = await createClient()

  // O `.eq('serie_id')` garante que só sai o que realmente está NESTA série.
  const { data, error } = await supabase
    .from('itens')
    .update({ serie_id: null })
    .in('id', parsed.itemIds)
    .eq('serie_id', parsed.serieId)
    .select('id')
  if (error) throw new Error(error.message)

  revalidateSeriesEListagens([parsed.serieId])
  return (data ?? []).length
}

export async function listarSeries(query: string) {
  const supabase = await createClient()
  let request = supabase
    .from('series')
    .select('id, nome, tipo, total_volumes, em_publicacao')
    .order('nome')

  if (query.trim()) {
    request = request.ilike('nome', `%${query.trim()}%`)
  }

  const { data, error } = await request
  if (error) throw new Error(error.message)
  return data ?? []
}
