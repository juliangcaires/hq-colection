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
      editora: parsed.editora || null,
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
      editora: parsed.editora || null,
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
  revalidatePath(`/serie/${id}`)
}

export async function deleteSerie(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('series').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/colecao')
  revalidatePath('/desejos')
}

type BuscarSerieRow = {
  id: string
  nome: string
  tipo: 'hq' | 'manga'
  editora: string | null
  total_volumes: number | null
  serie_tags:
    | { tag_id: string; tags: { id: string; nome: string; tipo: TipoTag; cor: string | null } | null }[]
    | null
}

export async function buscarSeries(query: string) {
  const supabase = await createClient()
  let request = supabase
    .from('series')
    .select('id, nome, tipo, editora, total_volumes, serie_tags(tag_id, tags(id, nome, tipo, cor))')
    .order('nome')
    .limit(20)

  if (query.trim()) {
    request = request.ilike('nome', `%${query.trim()}%`)
  }

  const { data, error } = await request
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as unknown as BuscarSerieRow[]

  return rows.map((s) => ({
    id: s.id,
    nome: s.nome,
    tipo: s.tipo,
    editora: s.editora,
    total_volumes: s.total_volumes,
    tags: (s.serie_tags ?? [])
      .map((st) => st.tags)
      .filter((t): t is NonNullable<typeof t> => Boolean(t)),
  }))
}
