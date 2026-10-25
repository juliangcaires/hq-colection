'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'
import {
  adquirirLoteSchema,
  candidatoCapaSchema,
  criarVolumesInputSchema,
  itemInputSchema,
  type AdquirirInput,
  type CriarVolumesInput,
  type ItemInput,
} from '@/lib/schemas'
import type { TipoObra } from '@/lib/types'
import { baixarEPersistirCapa, type CandidatoCapa } from '@/lib/capa-busca'
import { normalizarTermoBusca } from '@/lib/capa-termo'
import { novoCaminhoDeCapa, removerCapaAntiga } from '@/lib/supabase/capas'

const LIMITE_CAPA_BYTES = 5 * 1024 * 1024
const EXT_POR_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
import { FUSO_DO_APP, hojeIso } from '@/lib/datas'
import { lancarErroRpc } from '@/lib/rpc'

function revalidateListagens(itemId?: string) {
  revalidatePath('/colecao')
  revalidatePath('/desejos')
  revalidatePath('/')
  if (itemId) revalidatePath(`/item/${itemId}`)
}

function dadosDoItem(p: ItemInput) {
  return {
    serie_id: p.serie_id || null,
    titulo: p.titulo,
    numero_volume: p.numero_volume ?? null,
    tipo: p.tipo,
    isbn: p.isbn || null,
    estado: p.estado,
    prioridade: p.prioridade,
    preco: p.preco ?? null,
    loja: p.loja || null,
    data_aquisicao: p.data_aquisicao || null,
    nota: p.nota ?? null,
    observacoes: p.observacoes || null,
  }
}

async function createItemImpl(input: ItemInput) {
  const parsed = itemInputSchema.parse(input)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  // Item e tags numa transação só (migration 0007): se as tags falham, o item não fica pela metade.
  const { data, error } = await supabase.rpc('item_salvar', {
    p_id: null,
    p_dados: dadosDoItem(parsed),
    p_tag_ids: parsed.tagIds,
  })
  if (error) lancarErroRpc(error)

  revalidateListagens()
  return data as string
}

export async function createItem(input: ItemInput) {
  return executar(() => createItemImpl(input))
}

async function updateItemImpl(id: string, input: ItemInput) {
  const parsed = itemInputSchema.parse(input)
  const itemId = z.string().uuid().parse(id)
  const supabase = await createClient()

  const { error } = await supabase.rpc('item_salvar', {
    p_id: itemId,
    p_dados: dadosDoItem(parsed),
    p_tag_ids: parsed.tagIds,
  })
  if (error) lancarErroRpc(error)

  revalidateListagens(itemId)
}

export async function updateItem(id: string, input: ItemInput) {
  return executar(() => updateItemImpl(id, input))
}

async function deleteItemImpl(id: string) {
  const supabase = await createClient()
  const { data: existente, error: erroBusca } = await supabase
    .from('itens')
    .select('capa_url')
    .eq('id', id)
    .maybeSingle()
  if (erroBusca) throw new Error(erroBusca.message)
  if (!existente) throw new ErroDeNegocio('Item não encontrado')

  const { error } = await supabase.from('itens').delete().eq('id', id)
  if (error) throw new Error(error.message)
  await removerCapaAntiga(supabase, existente.capa_url, null)
  revalidateListagens()
}

export async function deleteItem(id: string) {
  return executar(() => deleteItemImpl(id))
}

/**
 * Fluxo B — marcar aquisição a partir da lista de desejos, de um item ou de vários.
 *
 * Preço, loja e data são iguais para todo o lote, então um `.in()` resolve — não
 * precisa do `Promise.all` por linha que `adicionarItensASerie` faz (lá o número
 * do volume muda a cada item). O preço é UNITÁRIO: vai o mesmo valor em cada um.
 */
async function marcarAdquiriEmLoteImpl(itemIds: string[], input: AdquirirInput) {
  const parsed = adquirirLoteSchema.parse({ ...input, itemIds })
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('itens')
    .update({
      estado: 'comprado',
      preco: parsed.preco ?? null,
      loja: parsed.loja || null,
      data_aquisicao: parsed.data_aquisicao || hojeIso(FUSO_DO_APP),
    })
    .in('id', parsed.itemIds)
    .eq('estado', 'desejo')
    .select('id')

  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new ErroDeNegocio('Esses itens já não estão na lista de desejos.')
  }

  revalidateListagens()
  for (const id of parsed.itemIds) revalidatePath(`/item/${id}`)
  return (data ?? []).length
}

export async function marcarAdquiriEmLote(itemIds: string[], input: AdquirirInput) {
  return executar(() => marcarAdquiriEmLoteImpl(itemIds, input))
}

export type ResumoCriacaoVolumes = {
  /** Título e tipo voltam junto para a busca de capa do lote não ter que reconstruí-los. */
  criados: { id: string; titulo: string; tipo: TipoObra }[]
  /** Números que já existiam na série e foram pulados. */
  ignorados: number[]
}

/**
 * Cria de uma vez os volumes de uma série ("comprei do 1 ao 3 e do 5 ao 7").
 *
 * A checagem de número repetido roda aqui, e não por constraint, pelo motivo
 * registrado na migration 0004: não existe `unique (serie_id, numero_volume)` —
 * `numero_volume` é numeric e nullable de propósito (séries não numeradas e
 * edições 1.5). Em série numerada, repetir é erro; sem numeração, é só ruído e
 * o volume repetido é pulado.
 */
async function criarVolumesEmLoteImpl(input: CriarVolumesInput): Promise<ResumoCriacaoVolumes> {
  const parsed = criarVolumesInputSchema.parse(input)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  // A trava por série, a checagem de repetidos e a criação (itens + tags) acontecem no banco, numa
  // transação: duas abas/retries ao mesmo tempo não geram volumes duplicados nem item sem tag.
  const { data, error } = await supabase.rpc('volumes_criar_em_lote', {
    p_serie: parsed.serieId,
    p_numeros: parsed.numeros,
    p_dados: {
      estado: parsed.estado,
      prioridade: parsed.prioridade,
      preco: parsed.preco ?? null,
      loja: parsed.loja || null,
      data_aquisicao: parsed.data_aquisicao || null,
    },
    p_tag_ids: parsed.tagIds,
  })
  if (error) lancarErroRpc(error)

  const resumo = data as { criados: ResumoCriacaoVolumes['criados']; ignorados: number[] }

  revalidateListagens()
  revalidatePath('/series')
  revalidatePath(`/serie/${parsed.serieId}`)
  return { criados: resumo.criados, ignorados: resumo.ignorados.map(Number).sort((a, b) => a - b) }
}

export async function criarVolumesEmLote(input: CriarVolumesInput) {
  return executar(() => criarVolumesEmLoteImpl(input))
}

/** Upload manual de capa (fallback normal — cobertura de edição BR é irregular). */
async function uploadCapaManualImpl(itemId: string, formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    throw new ErroDeNegocio('Arquivo inválido')
  }
  if (!EXT_POR_MIME[file.type]) {
    throw new ErroDeNegocio('Envie uma imagem JPEG, PNG ou WebP')
  }
  if (file.size > LIMITE_CAPA_BYTES) {
    throw new ErroDeNegocio('A imagem passa de 5 MB')
  }

  const ext = EXT_POR_MIME[file.type]
  const path = novoCaminhoDeCapa(user.id, itemId, ext)

  const { data: atual } = await supabase.from('itens').select('capa_url').eq('id', itemId).maybeSingle()
  if (!atual) throw new ErroDeNegocio('Item não encontrado')

  const { error: uploadError } = await supabase.storage
    .from('capas')
    .upload(path, file, { contentType: file.type })
  if (uploadError) throw new Error(uploadError.message)

  const { error: updateError } = await supabase
    .from('itens')
    .update({ capa_url: path, capa_origem: 'foto' })
    .eq('id', itemId)
  if (updateError) throw new Error(updateError.message)
  await removerCapaAntiga(supabase, atual.capa_url, path)

  revalidateListagens(itemId)
}

export async function uploadCapaManual(itemId: string, formData: FormData) {
  return executar(() => uploadCapaManualImpl(itemId, formData))
}

/** Aplica a capa que o usuário escolheu na grade de candidatos (busca automática, Fase 2). */
async function aplicarCapaEscolhidaImpl(itemId: string, candidatoBruto: CandidatoCapa) {
  const id = z.string().uuid().parse(itemId)
  const candidato = candidatoCapaSchema.parse(candidatoBruto)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  // Dono do item conferido ANTES de baixar qualquer coisa (a RLS filtra por user_id).
  const { data: existente, error: erroItem } = await supabase
    .from('itens')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (erroItem) throw new Error(erroItem.message)
  if (!existente) throw new ErroDeNegocio('Item não encontrado')

  const { data: anterior } = await supabase.from('itens').select('capa_url').eq('id', id).maybeSingle()
  const path = await baixarEPersistirCapa(supabase, user.id, id, candidato.url)
  if (!path) throw new ErroDeNegocio('Não foi possível baixar essa imagem')

  const { data: item, error } = await supabase
    .from('itens')
    .update({ capa_url: path, capa_origem: 'api' })
    .eq('id', id)
    .select('titulo, numero_volume, serie:series(id, nome)')
    .single<{ titulo: string; numero_volume: number | null; serie: { id: string; nome: string } | null }>()
  if (error) throw new Error(error.message)

  await removerCapaAntiga(supabase, anterior?.capa_url, path)

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

export async function aplicarCapaEscolhida(itemId: string, candidatoBruto: CandidatoCapa) {
  return executar(() => aplicarCapaEscolhidaImpl(itemId, candidatoBruto))
}
