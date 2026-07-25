'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { serieInputSchema, type SerieInput } from '@/lib/schemas'
import type { TipoTag } from '@/lib/types'

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
