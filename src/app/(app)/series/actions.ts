'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { lerTodasAsLinhas } from '@/lib/paginar'
import { calcularVolumesFaltantes, type VolumeParaFuros } from '@/lib/volumes'
import {
  itensComNumeroSchema,
  itensDaSerieSchema,
  serieInputSchema,
  type SerieInput,
} from '@/lib/schemas'
import type { EstadoItem, TipoObra, TipoTag } from '@/lib/types'
import { escaparLike } from '@/lib/like'
import { lancarErroRpc } from '@/lib/rpc'

function dadosDaSerie(p: SerieInput) {
  return {
    nome: p.nome,
    tipo: p.tipo,
    total_volumes: p.total_volumes ?? null,
    em_publicacao: p.em_publicacao,
    tem_numeracao: p.tem_numeracao,
    observacoes: p.observacoes || null,
  }
}

async function createSerieImpl(input: SerieInput) {
  const parsed = serieInputSchema.parse(input)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const { data, error } = await supabase.rpc('serie_salvar', {
    p_id: null,
    p_dados: dadosDaSerie(parsed),
    p_tag_ids: parsed.tagIds,
  })
  if (error) lancarErroRpc(error)

  revalidatePath('/colecao')
  revalidatePath('/desejos')
  revalidatePath('/series')
  return data as string
}

export async function createSerie(input: SerieInput) {
  return executar(() => createSerieImpl(input))
}

async function updateSerieImpl(id: string, input: SerieInput) {
  const parsed = serieInputSchema.parse(input)
  const serieId = z.string().uuid().parse(id)
  const supabase = await createClient()

  const { error } = await supabase.rpc('serie_salvar', {
    p_id: serieId,
    p_dados: dadosDaSerie(parsed),
    p_tag_ids: parsed.tagIds,
  })
  if (error) lancarErroRpc(error)

  revalidatePath('/colecao')
  revalidatePath('/desejos')
  revalidatePath('/series')
  revalidatePath(`/serie/${serieId}`)
}

export async function updateSerie(id: string, input: SerieInput) {
  return executar(() => updateSerieImpl(id, input))
}

async function deleteSerieImpl(id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('series').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new ErroDeNegocio('Série não encontrada')
  revalidatePath('/colecao')
  revalidatePath('/desejos')
  revalidatePath('/series')
}

export async function deleteSerie(id: string) {
  return executar(() => deleteSerieImpl(id))
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

    if (query.trim().slice(0, 100)) {
      const q = query.trim().slice(0, 100).toLowerCase()
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

  if (query.trim().slice(0, 100)) {
    request = request.ilike('nome', `%${escaparLike(query.trim().slice(0, 100))}%`)
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

export type FiltrosCandidatos = {
  serieId: string
  query: string
  incluirComSerie: boolean
  tipo?: TipoObra
  /** Mesma semântica da coleção: OR dentro de um tipo, AND entre tipos diferentes. */
  tagsPorTipo?: Partial<Record<TipoTag, string[]>>
}

/**
 * Ids dos itens que satisfazem o filtro de tags, resolvido em `item_tags` antes
 * da consulta principal — do contrário o teto de `LIMITE_CANDIDATOS` cairia
 * sobre a lista sem filtro e esconderia itens que casam.
 * `null` = sem filtro de tag; array vazio = nada casa.
 */
async function idsPorTags(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tagsPorTipo: Partial<Record<TipoTag, string[]>> | undefined
): Promise<string[] | null> {
  const grupos = Object.values(tagsPorTipo ?? {}).filter(
    (ids): ids is string[] => Array.isArray(ids) && ids.length > 0
  )
  if (grupos.length === 0) return null

  const vinculos = await lerTodasAsLinhas<{ item_id: string; tag_id: string }>((de, ate) =>
    supabase
      .from('item_tags')
      .select('item_id, tag_id')
      .in('tag_id', grupos.flat())
      .order('item_id')
      .order('tag_id')
      .range(de, ate)
  )

  const tagsDoItem = new Map<string, Set<string>>()
  for (const { item_id, tag_id } of vinculos) {
    const atual = tagsDoItem.get(item_id) ?? new Set<string>()
    atual.add(tag_id)
    tagsDoItem.set(item_id, atual)
  }

  const ids: string[] = []
  for (const [itemId, tags] of tagsDoItem) {
    if (grupos.every((grupo) => grupo.some((tagId) => tags.has(tagId)))) ids.push(itemId)
  }
  return ids
}

/**
 * Itens da coleção que podem ser agrupados nesta série. Por padrão só os avulsos
 * (`serie_id is null`); com `incluirComSerie`, também os que estão em outra série
 * (que seriam MOVIDOS). Nunca lista os que já pertencem a `serieId`.
 */
export async function buscarItensParaSerie(
  filtros: FiltrosCandidatos
): Promise<{ itens: ItemCandidato[]; truncado: boolean }> {
  const { query, incluirComSerie, tipo, tagsPorTipo } = filtros
  // Validado antes de entrar na string de filtro do PostgREST logo abaixo.
  const id = z.string().uuid().parse(filtros.serieId)
  const supabase = await createClient()

  const idsDeTags = await idsPorTags(supabase, tagsPorTipo)
  if (idsDeTags !== null && idsDeTags.length === 0) return { itens: [], truncado: false }

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

  if (query.trim().slice(0, 100)) {
    request = request.ilike('titulo', `%${escaparLike(query.trim().slice(0, 100))}%`)
  }

  if (tipo) request = request.eq('tipo', tipo)

  // Cortado no mesmo teto da consulta para a URL do PostgREST não estourar; se
  // passar disso a lista já vinha truncada de qualquer jeito.
  let cortadoPorTags = false
  if (idsDeTags !== null) {
    cortadoPorTags = idsDeTags.length > LIMITE_CANDIDATOS
    request = request.in('id', idsDeTags.slice(0, LIMITE_CANDIDATOS))
  }

  const { data, error } = await request
  if (error) throw new Error(error.message)

  type Row = Omit<ItemCandidato, 'capaUrl'> & { capa_url: string | null }
  const rows = (data ?? []) as unknown as Row[]

  const capaMap = urlsDeCapas(rows.map((r) => r.capa_url)
  )

  return {
    itens: rows.map(({ capa_url, ...resto }) => ({
      ...resto,
      capaUrl: capaMap.get(capa_url ?? '') ?? null,
    })),
    truncado: rows.length === LIMITE_CANDIDATOS || cortadoPorTags,
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
  /** Números repetidos numa série NÃO numerada — sem unique no banco, só dá para avisar. */
  volumesDuplicados: number[]
}

/** Números que aparecem mais de uma vez na lista, em ordem crescente. */
function numerosRepetidos(numeros: number[]): number[] {
  const vistos = new Set<number>()
  const repetidos = new Set<number>()
  for (const n of numeros) {
    if (vistos.has(n)) repetidos.add(n)
    else vistos.add(n)
  }
  return Array.from(repetidos).sort((a, b) => a - b)
}

/**
 * Agrupa vários itens já existentes na coleção sob uma série.
 *
 * Se a série tem `tem_numeracao`, cada item precisa vir com `numero` e o número
 * grava junto — sem número, ou com número repetido (entre os enviados ou contra
 * um volume que já está na série), nada é salvo. A regra mora aqui porque o
 * banco não tem unique de `(serie_id, numero_volume)`: a coluna é nullable e
 * numeric de propósito, para séries não numeradas e edições 1.5.
 * Séries sem a flag continuam como antes: só `serie_id`, número intocado.
 */
async function adicionarItensASerieImpl(
  serieId: string,
  itens: { itemId: string; numero: number | null }[]
): Promise<ResumoInclusao>  {
  const parsed = itensComNumeroSchema.parse({ serieId, itens })
  const itemIds = parsed.itens.map((i) => i.itemId)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const { data: serie, error: serieError } = await supabase
    .from('series')
    .select('id, tem_numeracao')
    .eq('id', parsed.serieId)
    .maybeSingle()
  if (serieError) throw new Error(serieError.message)
  if (!serie) throw new ErroDeNegocio('Série não encontrada')

  const temNumeracao = Boolean((serie as { tem_numeracao: boolean }).tem_numeracao)

  if (temNumeracao) {
    if (parsed.itens.some((i) => i.numero === null)) {
      throw new ErroDeNegocio('Esta série é numerada: informe o número de todos os volumes marcados.')
    }

    const repetidosNoEnvio = numerosRepetidos(parsed.itens.map((i) => i.numero as number))
    if (repetidosNoEnvio.length > 0) {
      throw new ErroDeNegocio(`Número repetido entre os volumes marcados: ${repetidosNoEnvio.join(', ')}`)
    }

    // Volumes que já estão na série e NÃO estão sendo reenviados (esses podem
    // estar sendo renumerados, então não conflitam consigo mesmos).
    const { data: jaNaSerie, error: jaNaSerieError } = await supabase
      .from('itens')
      .select('id, numero_volume')
      .eq('serie_id', parsed.serieId)
      .not('numero_volume', 'is', null)
    if (jaNaSerieError) throw new Error(jaNaSerieError.message)

    const enviados = new Set(itemIds)
    const ocupados = new Set(
      ((jaNaSerie ?? []) as { id: string; numero_volume: number }[])
        .filter((i) => !enviados.has(i.id))
        .map((i) => Number(i.numero_volume))
    )
    const colidindo = parsed.itens
      .map((i) => i.numero as number)
      .filter((n) => ocupados.has(n))
    if (colidindo.length > 0) {
      throw new ErroDeNegocio(
        `Número já usado por outro volume da série: ${Array.from(new Set(colidindo)).join(', ')}`
      )
    }
  }

  // As páginas das séries de origem também ficam desatualizadas quando um volume sai delas.
  const { data: antes, error: antesError } = await supabase
    .from('itens')
    .select('serie_id')
    .in('id', itemIds)
  if (antesError) throw new Error(antesError.message)
  const seriesDeOrigem = ((antes ?? []) as { serie_id: string | null }[]).map((i) => i.serie_id)

  // Sem `user_id` no update: a RLS `itens_owner` já restringe ao dono (mesmo padrão de updateItem).
  let incluidos: number
  if (temNumeracao) {
    // Número varia por linha, então o update em massa não serve.
    const resultados = await Promise.all(
      parsed.itens.map((i) =>
        supabase
          .from('itens')
          .update({ serie_id: parsed.serieId, numero_volume: i.numero })
          .eq('id', i.itemId)
          .select('id')
      )
    )
    const falha = resultados.find((r) => r.error)
    if (falha?.error) throw new Error(falha.error.message)
    incluidos = resultados.reduce((total, r) => total + (r.data ?? []).length, 0)
  } else {
    const { data: atualizados, error } = await supabase
      .from('itens')
      .update({ serie_id: parsed.serieId })
      .in('id', itemIds)
      .select('id')
    if (error) throw new Error(error.message)
    incluidos = (atualizados ?? []).length
  }

  // Só faz sentido avisar em série não numerada: na numerada a duplicidade já
  // foi barrada antes de escrever.
  let volumesDuplicados: number[] = []
  if (!temNumeracao) {
    const { data: volumes, error: volumesError } = await supabase
      .from('itens')
      .select('numero_volume')
      .eq('serie_id', parsed.serieId)
      .not('numero_volume', 'is', null)
    if (volumesError) throw new Error(volumesError.message)

    volumesDuplicados = numerosRepetidos(
      ((volumes ?? []) as { numero_volume: number }[]).map((v) => Number(v.numero_volume))
    )
  }

  revalidateSeriesEListagens([parsed.serieId, ...seriesDeOrigem])

  return {
    incluidos,
    ignorados: itemIds.length - incluidos,
    volumesDuplicados,
  }
}

export async function adicionarItensASerie(
  serieId: string,
  itens: { itemId: string; numero: number | null }[]
) {
  return executar(() => adicionarItensASerieImpl(serieId, itens))
}

/** Desvincula itens da série — eles voltam a ser avulsos, sem serem excluídos. */
async function removerItensDaSerieImpl(serieId: string, itemIds: string[]): Promise<number>  {
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

export async function removerItensDaSerie(serieId: string, itemIds: string[]) {
  return executar(() => removerItensDaSerieImpl(serieId, itemIds))
}

export type ResumoVolumesDaSerie = {
  total_volumes: number | null
  tem_numeracao: boolean
  /** Números inteiros já usados por volumes desta série. */
  numerosOcupados: number[]
  /** Furos, para o atalho "preencher os que faltam". */
  faltantes: number[]
}

/**
 * O que a inserção rápida precisa saber para criar vários volumes de uma série.
 *
 * É uma action à parte, chamada só quando a caixinha é marcada, para não inflar
 * a resposta de `buscarSeries` — que roda a cada tecla digitada no combobox.
 */
export async function resumoVolumesDaSerie(serieId: string): Promise<ResumoVolumesDaSerie> {
  const supabase = await createClient()

  const [{ data: serie, error: errSerie }, volumes] = await Promise.all([
    supabase
      .from('series')
      .select('total_volumes, tem_numeracao')
      .eq('id', serieId)
      .maybeSingle(),
    lerTodasAsLinhas<VolumeParaFuros>((de, ate) =>
      supabase.from('itens').select('numero_volume, estado').eq('serie_id', serieId).order('id').range(de, ate)
    ),
  ])
  if (errSerie) throw new Error(errSerie.message)
  if (!serie) throw new ErroDeNegocio('Série não encontrada')

  return {
    total_volumes: serie.total_volumes,
    tem_numeracao: Boolean(serie.tem_numeracao),
    numerosOcupados: volumes
      .map((v) => v.numero_volume)
      .filter((n): n is number => n !== null && Number.isInteger(n)),
    faltantes: calcularVolumesFaltantes(volumes, serie.total_volumes),
  }
}

export type SerieListada = {
  id: string
  nome: string
  tipo: TipoObra
  total_volumes: number | null
  em_publicacao: boolean
  /** Derivada na hora (nada é gravado): tem total declarado e você já tem tudo. */
  completa: boolean
}

export async function listarSeries(query: string): Promise<SerieListada[]> {
  const supabase = await createClient()
  const termo = query.trim().slice(0, 100)

  // Furos e "completa" são calculados no banco (função `series_com_resumo`, migration 0007):
  // antes cada tecla digitada baixava todos os volumes da coleção.
  const { data, error } = await supabase.rpc('series_com_resumo', {
    p_padrao: termo ? `%${escaparLike(termo)}%` : null,
  })
  if (error) throw new Error(error.message)

  return ((data ?? []) as (Omit<SerieListada, 'completa'> & { completa: boolean; tem_numeracao: boolean })[]).map(
    ({ id, nome, tipo, total_volumes, em_publicacao, completa }) => ({
      id,
      nome,
      tipo,
      total_volumes,
      em_publicacao,
      completa,
    })
  )
}
