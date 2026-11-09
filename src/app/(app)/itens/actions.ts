'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'
import {
  adquirirLoteSchema,
  estadoItemSchema,
  notaSchema,
  candidatoCapaSchema,
  criarVolumesInputSchema,
  itemInputSchema,
  type AdquirirInput,
  type CriarVolumesInput,
  type ItemInput,
} from '@/lib/schemas'
import type { TipoObra } from '@/lib/types'
import { type CandidatoCapa } from '@/lib/capa-busca'
import {
  aplicarCapaDeApi,
  aplicarFotoDoUsuario,
  chavesDoItem,
  registrarMemoriaGlobal,
  usuarioContribuiCapas,
} from '@/lib/capa-catalogo'
import { normalizarTermoBusca } from '@/lib/capa-termo'
import { novoCaminhoDeCapa, removerCapaAntiga } from '@/lib/supabase/capas'

const LIMITE_CAPA_BYTES = 5 * 1024 * 1024
const EXT_POR_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
import { FUSO_DO_APP, hojeIso } from '@/lib/datas'
import { lancarErroRpc } from '@/lib/rpc'
import { alimentarCatalogoComItem } from '@/lib/isbn-supabase'

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
    critica: p.critica || null,
    lido_em: p.estado === 'lido' ? p.lido_em || null : null,
  }
}

function catalogoDoItem(p: ItemInput) {
  return {
    isbn: p.isbn,
    titulo: p.titulo,
    serieId: p.serie_id,
    numeroVolume: p.numero_volume,
    tipo: p.tipo,
    tagIds: p.tagIds,
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

  // Catálogo é acessório: nunca derruba o salvamento (a função não lança).
  await alimentarCatalogoComItem(supabase, data as string, catalogoDoItem(parsed))

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

  await alimentarCatalogoComItem(supabase, itemId, catalogoDoItem(parsed))

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

const avaliacaoSchema = z.object({
  nota: notaSchema.nullish(),
  critica: z.string().trim().max(2000).nullish(),
})
export type AvaliacaoLeitura = { nota?: number | null; critica?: string | null }

const idsEmLoteSchema = z.array(z.string().uuid()).min(1, 'Selecione ao menos um item').max(500)

/** Remove vários itens (e as capas deles) de uma vez — coleção ou desejos. */
async function removerItensEmLoteImpl(itemIds: string[]) {
  const ids = idsEmLoteSchema.parse(itemIds)
  const supabase = await createClient()

  const { data, error } = await supabase.from('itens').delete().in('id', ids).select('id, capa_url')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new ErroDeNegocio('Esses itens já não existem.')

  await Promise.all(data.map((i) => removerCapaAntiga(supabase, i.capa_url, null)))

  revalidateListagens()
  revalidatePath('/series')
  for (const id of ids) revalidatePath(`/item/${id}`)
  return data.length
}

export async function removerItensEmLote(itemIds: string[]) {
  return executar(() => removerItensEmLoteImpl(itemIds))
}

/** Marca vários itens comprados como lidos. Só vale para quem está "comprado": desejo ainda não foi lido. */
async function marcarLidoEmLoteImpl(itemIds: string[], avaliacao?: AvaliacaoLeitura) {
  const ids = idsEmLoteSchema.parse(itemIds)
  const av = avaliacaoSchema.parse(avaliacao ?? {})
  const supabase = await createClient()

  // `lido_em` é preenchido pelo trigger `trg_itens_lido_em` (migration 0010) quando o estado vira `lido`.
  // Estado, nota e crítica na mesma escrita: não existe "lido" sem a avaliação que acabou de ser dada.
  const { data, error } = await supabase
    .from('itens')
    .update({ estado: 'lido', ...(av.nota != null && { nota: av.nota }), ...(av.critica && { critica: av.critica }) })
    .in('id', ids)
    .eq('estado', 'comprado')
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new ErroDeNegocio('Só itens comprados podem ser marcados como lidos.')

  revalidateListagens()
  revalidatePath('/series')
  for (const id of ids) revalidatePath(`/item/${id}`)
  return data.length
}

export async function marcarLidoEmLote(itemIds: string[], avaliacao?: AvaliacaoLeitura) {
  return executar(() => marcarLidoEmLoteImpl(itemIds, avaliacao))
}

export type ModoAvaliacaoSerie =
  /** Só a série: nota e crítica gerais, volumes sem nota nova. */
  | 'serie'
  /** Série e volumes lidos sem nota: não toca em volume já avaliado. */
  | 'serie_e_sem_nota'
  /** Série e todos os volumes lidos: a nota dos volumes é substituída (a crítica deles nunca). */
  | 'serie_e_todos'
  /** Sem nota própria: a série passa a valer a média dos volumes (a crítica da série é mantida). */
  | 'media'

const avaliarSerieSchema = z.object({
  serieId: z.string().uuid(),
  modo: z.enum(['serie', 'serie_e_sem_nota', 'serie_e_todos', 'media']),
  nota: notaSchema.nullish(),
  critica: z.string().trim().max(2000).nullish(),
})

/**
 * Avalia a série sem marcar nada como lido (`serie_marcar_lida` com `p_marcar_lidos = false`).
 * A crítica da série só vai para volumes lidos que não têm crítica; nenhuma avaliação individual
 * é sobrescrita, a menos que o usuário escolha `serie_e_todos` (e aí só a nota muda).
 */
async function avaliarSerieImpl(input: {
  serieId: string
  modo: ModoAvaliacaoSerie
  nota?: number | null
  critica?: string | null
}) {
  const { serieId, modo, nota, critica } = avaliarSerieSchema.parse(input)
  const supabase = await createClient()

  if (modo === 'media') {
    const { data: serie, error } = await supabase.from('series').update({ nota: null }).eq('id', serieId).select('id')
    if (error) throw new Error(error.message)
    if (!serie || serie.length === 0) throw new ErroDeNegocio('Série não encontrada.')
    revalidarSerie(serieId)
    return { volumes: 0 }
  }

  const { data, error } = await supabase.rpc('serie_marcar_lida', {
    p_serie: serieId,
    p_nota: nota ?? null,
    // '' limpa a crítica da série; null deixa como está.
    p_critica: critica ?? null,
    p_modo: modo,
    p_marcar_lidos: false,
  })
  if (error) lancarErroRpc(error)

  const r = data as { avaliados: number; snapshot: SnapshotMarcacaoSerie }
  revalidarSerie(serieId, r.snapshot.itens.map((i) => i.id))
  return { volumes: r.avaliados }
}

export async function avaliarSerie(input: {
  serieId: string
  modo: ModoAvaliacaoSerie
  nota?: number | null
  critica?: string | null
}) {
  return executar(() => avaliarSerieImpl(input))
}

export type ModoMarcacaoSerie = 'serie' | 'serie_e_sem_nota' | 'serie_e_todos'

/** Estado anterior dos itens e da série afetados, devolvido por `serie_marcar_lida` para o "Desfazer". */
export type SnapshotMarcacaoSerie = {
  serie: { id: string; nota: number | null; critica: string | null }
  itens: { id: string; estado: 'desejo' | 'comprado' | 'lido'; nota: number | null; critica: string | null; lido_em: string | null }[]
}

export type ResumoMarcacaoSerie = {
  marcados: number
  avaliados: number
  criticas: number
  desejosIgnorados: number
  snapshot: SnapshotMarcacaoSerie
}

const marcarSerieSchema = z.object({
  serieId: z.string().uuid(),
  modo: z.enum(['serie', 'serie_e_sem_nota', 'serie_e_todos']).default('serie_e_sem_nota'),
  nota: notaSchema.nullish(),
  critica: z.string().trim().max(2000).nullish(),
})

const snapshotSchema = z.object({
  serie: z.object({
    id: z.string().uuid(),
    nota: z.number().min(0.5).max(5).nullable(),
    critica: z.string().max(2000).nullable(),
  }),
  itens: z
    .array(
      z.object({
        id: z.string().uuid(),
        estado: estadoItemSchema,
        nota: z.number().min(0.5).max(5).nullable(),
        critica: z.string().max(2000).nullable(),
        lido_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      }),
    )
    .max(2000),
})

function revalidarSerie(serieId: string, itemIds: string[] = []) {
  revalidateListagens()
  revalidatePath(`/serie/${serieId}`)
  revalidatePath('/series')
  revalidatePath('/ranking')
  for (const id of itemIds) revalidatePath(`/item/${id}`)
}

/**
 * Marca como lidos os volumes `comprado` da série e aplica nota/crítica (função SQL `serie_marcar_lida`,
 * transacional). Nota e crítica são opcionais ("Pular" só marca). A crítica nunca sobrescreve a de um volume.
 */
async function marcarSerieComoLidaImpl(input: z.input<typeof marcarSerieSchema>): Promise<ResumoMarcacaoSerie> {
  const { serieId, modo, nota, critica } = marcarSerieSchema.parse(input)
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('serie_marcar_lida', {
    p_serie: serieId,
    p_nota: nota ?? null,
    p_critica: critica || null,
    p_modo: modo,
    p_marcar_lidos: true,
  })
  if (error) lancarErroRpc(error)

  const r = data as {
    marcados: number
    avaliados: number
    criticas: number
    desejos_ignorados: number
    snapshot: SnapshotMarcacaoSerie
  }
  revalidarSerie(serieId, r.snapshot.itens.map((i) => i.id))
  return {
    marcados: r.marcados,
    avaliados: r.avaliados,
    criticas: r.criticas,
    desejosIgnorados: r.desejos_ignorados,
    snapshot: r.snapshot,
  }
}

export async function marcarSerieComoLida(input: z.input<typeof marcarSerieSchema>) {
  return executar(() => marcarSerieComoLidaImpl(input))
}

/** Desfaz `marcarSerieComoLida`: restaura estado, nota, crítica e `lido_em` dos itens e a avaliação da série. */
async function desfazerMarcacaoSerieImpl(snapshotBruto: SnapshotMarcacaoSerie) {
  const snapshot = snapshotSchema.parse(snapshotBruto)
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('serie_desfazer_marcacao', {
    p_serie: snapshot.serie.id,
    p_snapshot: snapshot,
  })
  if (error) lancarErroRpc(error)

  revalidarSerie(snapshot.serie.id, snapshot.itens.map((i) => i.id))
  return data as number
}

export async function desfazerMarcacaoSerie(snapshot: SnapshotMarcacaoSerie) {
  return executar(() => desfazerMarcacaoSerieImpl(snapshot))
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

  // Opt-in "Contribuir com as capas que eu enviar": a foto (sem metadados) vai para o catálogo público e o
  // item aponta para ela. Sem opt-in, ou se a publicação falhar, segue o caminho privado de sempre.
  if (await usuarioContribuiCapas(supabase, user.id)) {
    const publica = await aplicarFotoDoUsuario(supabase, itemId, new Uint8Array(await file.arrayBuffer()))
    if (publica) {
      await removerCapaAntiga(supabase, atual.capa_url, publica)
      revalidateListagens(itemId)
      return
    }
  }

  const { error: uploadError } = await supabase.storage
    .from('capas')
    .upload(path, file, { contentType: file.type })
  if (uploadError) throw new Error(uploadError.message)

  const { error: updateError } = await supabase
    .from('itens')
    .update({ capa_url: path, capa_origem: 'foto', capa_catalogo_id: null })
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

  // Capa que outro colecionador já publicou: só aponta o item para ela (a função confere dono e se não foi ocultada).
  if (candidato.provedor === 'comunidade') {
    if (!candidato.ref) throw new ErroDeNegocio('Capa da comunidade inválida')
    const { data: caminho, error: erroAplicar } = await supabase.rpc('capa_catalogo_aplicar', { p_item: id, p_capa: candidato.ref })
    if (erroAplicar) {
      if (erroAplicar.message === 'capa_indisponivel') throw new ErroDeNegocio('Esta capa não está mais disponível.')
      lancarErroRpc(erroAplicar)
    }
    await removerCapaAntiga(supabase, anterior?.capa_url, `pub/${caminho as string}`)
    revalidateListagens(itemId)
    return
  }

  // Baixa, publica no catálogo compartilhado e aponta o item para ela (sem cópia própria).
  const path = await aplicarCapaDeApi(supabase, id, candidato.url)
  if (!path) throw new ErroDeNegocio('Não foi possível baixar essa imagem')

  const { data: item, error } = await supabase
    .from('itens')
    .select('titulo, numero_volume, serie:series(id, nome)')
    .eq('id', id)
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
    // ...e conta uma confirmação na memória compartilhada, para o próximo colecionador da mesma série pular a resolução.
    const chaves = await chavesDoItem(supabase, id)
    await registrarMemoriaGlobal(supabase, chaves?.serieChave ?? null, termo.termo, candidato.provedor, candidato.ref ?? null)
  }

  revalidateListagens(itemId)
}

export async function aplicarCapaEscolhida(itemId: string, candidatoBruto: CandidatoCapa) {
  return executar(() => aplicarCapaEscolhidaImpl(itemId, candidatoBruto))
}
