'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { adquirirInputSchema, itemInputSchema, type AdquirirInput, type ItemInput } from '@/lib/schemas'
import { baixarEPersistirCapa, type CandidatoCapa } from '@/lib/capa-busca'
import { normalizarTermoBusca } from '@/lib/capa-termo'

function revalidateListagens(itemId?: string) {
  revalidatePath('/colecao')
  revalidatePath('/desejos')
  revalidatePath('/')
  if (itemId) revalidatePath(`/item/${itemId}`)
}

export async function createItem(input: ItemInput) {
  const parsed = itemInputSchema.parse(input)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: item, error } = await supabase
    .from('itens')
    .insert({
      user_id: user.id,
      serie_id: parsed.serie_id || null,
      titulo: parsed.titulo,
      numero_volume: parsed.numero_volume ?? null,
      tipo: parsed.tipo,
      isbn: parsed.isbn || null,
      estado: parsed.estado,
      prioridade: parsed.prioridade,
      preco: parsed.preco ?? null,
      loja: parsed.loja || null,
      data_aquisicao: parsed.data_aquisicao || null,
      nota: parsed.nota ?? null,
      observacoes: parsed.observacoes || null,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  if (parsed.tagIds.length > 0) {
    const rows = parsed.tagIds.map((tag_id) => ({ item_id: item.id, tag_id }))
    const { error: tagError } = await supabase.from('item_tags').insert(rows)
    if (tagError) throw new Error(tagError.message)
  }

  revalidateListagens()
  return item.id as string
}

export async function updateItem(id: string, input: ItemInput) {
  const parsed = itemInputSchema.parse(input)
  const supabase = await createClient()

  const { error } = await supabase
    .from('itens')
    .update({
      serie_id: parsed.serie_id || null,
      titulo: parsed.titulo,
      numero_volume: parsed.numero_volume ?? null,
      tipo: parsed.tipo,
      isbn: parsed.isbn || null,
      estado: parsed.estado,
      prioridade: parsed.prioridade,
      preco: parsed.preco ?? null,
      loja: parsed.loja || null,
      data_aquisicao: parsed.data_aquisicao || null,
      nota: parsed.nota ?? null,
      observacoes: parsed.observacoes || null,
    })
    .eq('id', id)

  if (error) throw new Error(error.message)

  const { error: clearError } = await supabase.from('item_tags').delete().eq('item_id', id)
  if (clearError) throw new Error(clearError.message)

  if (parsed.tagIds.length > 0) {
    const rows = parsed.tagIds.map((tag_id) => ({ item_id: id, tag_id }))
    const { error: tagError } = await supabase.from('item_tags').insert(rows)
    if (tagError) throw new Error(tagError.message)
  }

  revalidateListagens(id)
}

export async function deleteItem(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('itens').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidateListagens()
}

/** Fluxo B — marcar aquisição a partir da lista de desejos. */
export async function marcarAdquiri(id: string, input: AdquirirInput) {
  const parsed = adquirirInputSchema.parse(input)
  const supabase = await createClient()

  const { error } = await supabase
    .from('itens')
    .update({
      estado: 'comprado',
      preco: parsed.preco ?? null,
      loja: parsed.loja || null,
      data_aquisicao: parsed.data_aquisicao || new Date().toISOString().slice(0, 10),
    })
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidateListagens(id)
}

export async function marcarLido(id: string, lido: boolean) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('itens')
    .update({ estado: lido ? 'lido' : 'comprado' })
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidateListagens(id)
}

/** Upload manual de capa (fallback normal — cobertura de edição BR é irregular). */
export async function uploadCapaManual(itemId: string, formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    throw new Error('Arquivo inválido')
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Envie um arquivo de imagem')
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${user.id}/${itemId}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('capas')
    .upload(path, file, { upsert: true, contentType: file.type })
  if (uploadError) throw new Error(uploadError.message)

  const { error: updateError } = await supabase
    .from('itens')
    .update({ capa_url: path, capa_origem: 'foto' })
    .eq('id', itemId)
  if (updateError) throw new Error(updateError.message)

  revalidateListagens(itemId)
}

/** Aplica a capa que o usuário escolheu na grade de candidatos (busca automática, Fase 2). */
export async function aplicarCapaEscolhida(itemId: string, candidato: CandidatoCapa) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const path = await baixarEPersistirCapa(supabase, user.id, itemId, candidato.url)
  if (!path) throw new Error('Não foi possível baixar essa imagem')

  const { data: item, error } = await supabase
    .from('itens')
    .update({ capa_url: path, capa_origem: 'api' })
    .eq('id', itemId)
    .select('titulo, numero_volume, serie:series(id, nome)')
    .single<{ titulo: string; numero_volume: number | null; serie: { id: string; nome: string } | null }>()
  if (error) throw new Error(error.message)

  // Grava o que funcionou nesta série — o próximo volume reaproveita em vez de buscar do zero.
  if (item?.serie) {
    const termo = normalizarTermoBusca(item.titulo, item.serie.nome, item.numero_volume)
    await supabase
      .from('series')
      .update({
        busca_termo: termo.termo,
        busca_provedor: candidato.provedor,
        busca_ref: candidato.ref ?? null,
        busca_atualizado_em: new Date().toISOString(),
      })
      .eq('id', item.serie.id)
  }

  revalidateListagens(itemId)
}
