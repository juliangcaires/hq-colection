'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { tagInputSchema } from '@/lib/schemas'
import { lerTodasAsLinhas } from '@/lib/paginar'
import type { TipoTag } from '@/lib/types'

export async function createTag(input: { nome: string; tipo: TipoTag }) {
  const parsed = tagInputSchema.parse(input)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data, error } = await supabase
    .from('tags')
    .insert({ user_id: user.id, nome: parsed.nome, tipo: parsed.tipo })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/tags')
  return data.id as string
}

export async function updateTag(id: string, input: { nome: string; tipo: TipoTag }) {
  const parsed = tagInputSchema.parse(input)
  const supabase = await createClient()

  const { error } = await supabase
    .from('tags')
    .update({ nome: parsed.nome, tipo: parsed.tipo })
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath('/tags')
  revalidatePath('/colecao')
  revalidatePath('/desejos')
}

export async function deleteTag(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('tags').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/tags')
  revalidatePath('/colecao')
  revalidatePath('/desejos')
}

export async function buscarTags(query: string) {
  const supabase = await createClient()
  let request = supabase.from('tags').select('id, nome, tipo, cor').order('nome').limit(30)
  if (query.trim()) request = request.ilike('nome', `%${query.trim()}%`)
  const { data, error } = await request
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Busca tags restritas a um tipo — usada pelos selects dedicados (editora, personagem, arco, ...). */
export async function buscarTagsPorTipo(tipo: TipoTag, query: string) {
  const supabase = await createClient()
  let request = supabase
    .from('tags')
    .select('id, nome, tipo, cor')
    .eq('tipo', tipo)
    .order('nome')
    .limit(30)
  if (query.trim()) request = request.ilike('nome', `%${query.trim()}%`)
  const { data, error } = await request
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Reatribui todos os vínculos (série e item) das tags de origem para a tag de destino, depois apaga as de origem. */
export async function mergeTags(sourceIds: string[], targetId: string) {
  const ids = sourceIds.filter((id) => id !== targetId)
  if (ids.length === 0) return

  const supabase = await createClient()

  const serieLinks = await lerTodasAsLinhas<{ serie_id: string }>((de, ate) =>
    supabase.from('serie_tags').select('serie_id, tag_id').in('tag_id', ids).order('serie_id').order('tag_id').range(de, ate)
  )
  const itemLinks = await lerTodasAsLinhas<{ item_id: string }>((de, ate) =>
    supabase.from('item_tags').select('item_id, tag_id').in('tag_id', ids).order('item_id').order('tag_id').range(de, ate)
  )

  if (serieLinks.length > 0) {
    const rows = serieLinks.map((l) => ({ serie_id: l.serie_id, tag_id: targetId }))
    const { error } = await supabase.from('serie_tags').upsert(rows, { onConflict: 'serie_id,tag_id' })
    if (error) throw new Error(error.message)
  }

  if (itemLinks.length > 0) {
    const rows = itemLinks.map((l) => ({ item_id: l.item_id, tag_id: targetId }))
    const { error } = await supabase.from('item_tags').upsert(rows, { onConflict: 'item_id,tag_id' })
    if (error) throw new Error(error.message)
  }

  const { error: deleteError } = await supabase.from('tags').delete().in('id', ids)
  if (deleteError) throw new Error(deleteError.message)

  revalidatePath('/tags')
  revalidatePath('/colecao')
  revalidatePath('/desejos')
}
