import type { SupabaseClient } from '@supabase/supabase-js'
import { baixarEPersistirCapa, buscarCapaPorIsbn } from '@/lib/capa-busca'
import { normalizarIsbn } from '@/lib/isbn'
import { ErroDeNegocio } from '@/lib/resultado'
import { lancarErroRpc } from '@/lib/rpc'
import { cadastroIsbnSchema, type CadastroIsbnInput, type ReferenciaDeTag } from '@/lib/schemas'
import type { TipoTag } from '@/lib/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

/** Tag existente (por nome e tipo) ou nova. Duas confirmações ao mesmo tempo não geram erro de duplicidade. */
async function garantirTag(supabase: Cliente, userId: string, nome: string, tipo: TipoTag): Promise<string> {
  const buscar = async () => {
    const { data, error } = await supabase.from('tags').select('id').eq('tipo', tipo).eq('nome', nome).maybeSingle()
    if (error) throw new Error(error.message)
    return (data?.id as string | undefined) ?? null
  }
  const existente = await buscar()
  if (existente) return existente
  const { data, error } = await supabase.from('tags').insert({ user_id: userId, nome, tipo }).select('id').single()
  if (error) {
    const aposCorrida = await buscar()
    if (aposCorrida) return aposCorrida
    throw new Error(error.message)
  }
  return data.id as string
}

async function resolverTag(supabase: Cliente, userId: string, ref: ReferenciaDeTag, tipo: TipoTag): Promise<string> {
  return 'tagId' in ref ? ref.tagId : garantirTag(supabase, userId, ref.criar, tipo)
}

/**
 * Cria o item a partir de uma edição confirmada na prévia: série (existente ou nova), tags de editora e
 * autor, item (com `edicao_id`) e capa. Só chega aqui o que a pessoa confirmou.
 *
 * Série e tags são criadas antes do item; se o item falha, a série nova (ainda vazia) é apagada. Tags
 * novas são inofensivas e ficam. A capa é acessório: falhar nela não desfaz o item.
 */
export async function cadastrarEdicao(
  supabase: Cliente,
  userId: string,
  entrada: CadastroIsbnInput
): Promise<{ itemId: string; capa: boolean; serieId: string | null }> {
  const input = cadastroIsbnSchema.parse(entrada)
  const isbn13 = normalizarIsbn(input.isbn13)
  if (!isbn13) throw new ErroDeNegocio('ISBN inválido.')

  const editoraTagId = input.editora ? await resolverTag(supabase, userId, input.editora, 'editora') : null
  const autoresTagIds = await Promise.all(input.autores.map((a) => resolverTag(supabase, userId, a, 'autor')))

  let serieId: string | null = null
  let serieCriada = false
  if (input.serie && 'id' in input.serie) {
    serieId = input.serie.id
  } else if (input.serie) {
    const { data, error } = await supabase.rpc('serie_salvar', {
      p_id: null,
      p_dados: {
        nome: input.serie.nova,
        tipo: input.tipo,
        total_volumes: null,
        em_publicacao: true,
        tem_numeracao: input.numero_volume !== null,
      },
      p_tag_ids: editoraTagId ? [editoraTagId] : [],
    })
    if (error) lancarErroRpc(error)
    serieId = data as string
    serieCriada = true
  }

  // Série nova já nasce com a editora; nos demais casos a editora vai no próprio item.
  const tagIds = [...(editoraTagId && !serieCriada ? [editoraTagId] : []), ...autoresTagIds]

  let itemId: string
  try {
    const { data, error } = await supabase.rpc('item_salvar', {
      p_id: null,
      p_dados: {
        serie_id: serieId,
        titulo: input.titulo,
        numero_volume: input.numero_volume,
        tipo: input.tipo,
        isbn: isbn13,
        estado: input.estado,
        prioridade: 0,
        edicao_id: input.edicaoId ?? null,
      },
      p_tag_ids: Array.from(new Set(tagIds)),
    })
    if (error) lancarErroRpc(error)
    itemId = data as string
  } catch (e) {
    if (serieCriada && serieId) await supabase.from('series').delete().eq('id', serieId)
    throw e
  }

  const capa = await aplicarCapaDaEdicao(supabase, userId, itemId, isbn13, input.edicaoId ?? null)
  return { itemId, capa, serieId }
}

/** Capa da edição (a que a API informou) e, se não der, a cascata por ISBN já existente. Nunca lança. */
async function aplicarCapaDaEdicao(
  supabase: Cliente,
  userId: string,
  itemId: string,
  isbn13: string,
  edicaoId: string | null
): Promise<boolean> {
  try {
    const urls: string[] = []
    if (edicaoId) {
      const { data } = await supabase.from('edicoes').select('capa_url_externa').eq('id', edicaoId).maybeSingle()
      if (data?.capa_url_externa) urls.push(data.capa_url_externa as string)
    }
    for (let i = 0; i <= urls.length; i++) {
      const url = urls[i] ?? (await buscarCapaPorIsbn(isbn13))?.url
      if (!url) return false
      const path = await baixarEPersistirCapa(supabase, userId, itemId, url)
      if (path) {
        const { error } = await supabase.from('itens').update({ capa_url: path, capa_origem: 'api' }).eq('id', itemId)
        return !error
      }
    }
    return false
  } catch (e) {
    console.warn('[isbn] capa não aplicada:', e instanceof Error ? e.message : 'erro')
  }
  return false
}
