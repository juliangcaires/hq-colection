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
import { removerCapaAntiga } from '@/lib/supabase/capas'

const EXT_POR_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
import { FUSO_DO_APP, hojeIso } from '@/lib/datas'

function revalidateListagens(itemId?: string) {
  revalidatePath('/colecao')
  revalidatePath('/desejos')
  revalidatePath('/')
  if (itemId) revalidatePath(`/item/${itemId}`)
}

async function createItemImpl(input: ItemInput) {
  const parsed = itemInputSchema.parse(input)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

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

export async function createItem(input: ItemInput) {
  return executar(() => createItemImpl(input))
}

async function updateItemImpl(id: string, input: ItemInput) {
  const parsed = itemInputSchema.parse(input)
  const supabase = await createClient()

  const { data, error } = await supabase
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
    .select('id')

  if (error) throw new Error(error.message)
  // A RLS filtra itens de outro usuário/inexistentes: 0 linhas não é sucesso.
  if (!data || data.length === 0) throw new ErroDeNegocio('Item não encontrado')

  const { error: clearError } = await supabase.from('item_tags').delete().eq('item_id', id)
  if (clearError) throw new Error(clearError.message)

  if (parsed.tagIds.length > 0) {
    const rows = parsed.tagIds.map((tag_id) => ({ item_id: id, tag_id }))
    const { error: tagError } = await supabase.from('item_tags').insert(rows)
    if (tagError) throw new Error(tagError.message)
  }

  revalidateListagens(id)
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
async function criarVolumesEmLoteImpl(input: CriarVolumesInput): Promise<ResumoCriacaoVolumes>  {
  const parsed = criarVolumesInputSchema.parse(input)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const [{ data: serie, error: errSerie }, { data: existentes, error: errItens }] = await Promise.all(
    [
      supabase
        .from('series')
        .select('id, nome, tipo, tem_numeracao')
        .eq('id', parsed.serieId)
        .maybeSingle(),
      supabase.from('itens').select('numero_volume').eq('serie_id', parsed.serieId),
    ]
  )
  if (errSerie) throw new Error(errSerie.message)
  if (errItens) throw new Error(errItens.message)
  if (!serie) throw new ErroDeNegocio('Série não encontrada')

  const ocupados = new Set(
    (existentes ?? [])
      .map((i: { numero_volume: number | null }) => i.numero_volume)
      .filter((n): n is number => n !== null)
  )
  const numeros = Array.from(new Set(parsed.numeros)).sort((a, b) => a - b)
  const repetidos = numeros.filter((n) => ocupados.has(n))

  if (serie.tem_numeracao && repetidos.length > 0) {
    throw new ErroDeNegocio(
      `Esta série já tem ${repetidos.map((n) => `#${n}`).join(', ')} — desmarque ou renumere`
    )
  }

  const aCriar = numeros.filter((n) => !ocupados.has(n))
  if (aCriar.length === 0) return { criados: [], ignorados: repetidos }

  const rows = aCriar.map((n) => ({
    user_id: user.id,
    serie_id: parsed.serieId,
    // Mesmo formato do título automático da inserção rápida.
    titulo: `${serie.nome} #${n}`,
    numero_volume: n,
    tipo: serie.tipo,
    estado: parsed.estado,
    prioridade: parsed.prioridade,
    preco: parsed.preco ?? null,
    loja: parsed.loja || null,
    data_aquisicao: parsed.data_aquisicao || null,
  }))

  const { data, error } = await supabase.from('itens').insert(rows).select('id, titulo, tipo, numero_volume')
  if (error) throw new Error(error.message)

  let criados = (data ?? []) as (ResumoCriacaoVolumes['criados'][number] & { numero_volume: number })[]
  const ignoradosPorConcorrencia: number[] = []

  if (serie.tem_numeracao && criados.length > 0) {
    // A checagem acima é "ler e depois inserir": duas abas/retries ao mesmo tempo passam ambas.
    // Sem constraint (ver migration 0004), cada requisição reconfere e desfaz SÓ as próprias linhas
    // que perderam — vence a mais antiga (created_at, id), então as duas chegam à mesma conclusão.
    const { data: todas, error: erroConferencia } = await supabase
      .from('itens')
      .select('id, numero_volume, created_at')
      .eq('serie_id', parsed.serieId)
      .in('numero_volume', aCriar)
      .order('created_at')
      .order('id')
    if (erroConferencia) throw new Error(erroConferencia.message)

    const vencedor = new Map<number, string>()
    for (const linha of (todas ?? []) as { id: string; numero_volume: number }[]) {
      if (!vencedor.has(linha.numero_volume)) vencedor.set(linha.numero_volume, linha.id)
    }
    const perdedores = criados.filter((c) => vencedor.get(c.numero_volume) !== c.id)
    if (perdedores.length > 0) {
      const { error: erroLimpeza } = await supabase
        .from('itens')
        .delete()
        .in('id', perdedores.map((c) => c.id))
      if (erroLimpeza) throw new Error(erroLimpeza.message)
      ignoradosPorConcorrencia.push(...perdedores.map((c) => c.numero_volume))
      criados = criados.filter((c) => vencedor.get(c.numero_volume) === c.id)
    }
  }

  if (parsed.tagIds.length > 0 && criados.length > 0) {
    const links = criados.flatMap(({ id }) =>
      parsed.tagIds.map((tag_id) => ({ item_id: id, tag_id }))
    )
    const { error: tagError } = await supabase.from('item_tags').insert(links)
    if (tagError) throw new Error(tagError.message)
  }

  revalidateListagens()
  revalidatePath('/series')
  revalidatePath(`/serie/${parsed.serieId}`)
  return {
    criados: criados.map(({ id, titulo, tipo }) => ({ id, titulo, tipo })),
    ignorados: [...repetidos, ...ignoradosPorConcorrencia].sort((a, b) => a - b),
  }
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
  if (!file.type.startsWith('image/')) {
    throw new ErroDeNegocio('Envie um arquivo de imagem')
  }

  const ext = EXT_POR_MIME[file.type] ?? 'jpg'
  const path = `${user.id}/${itemId}.${ext}`

  const { data: atual } = await supabase.from('itens').select('capa_url').eq('id', itemId).maybeSingle()
  if (!atual) throw new ErroDeNegocio('Item não encontrado')

  const { error: uploadError } = await supabase.storage
    .from('capas')
    .upload(path, file, { upsert: true, contentType: file.type })
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
