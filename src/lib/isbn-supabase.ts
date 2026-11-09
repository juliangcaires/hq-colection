import type { SupabaseClient } from '@supabase/supabase-js'
import { isbn13ParaIsbn10, normalizarIsbn } from '@/lib/isbn'
import { chaveDaEdicao, type CatalogoEdicoes, type EdicaoDados } from '@/lib/isbn-busca'
import type { EstadoItem } from '@/lib/types'

/** Acesso ao catálogo de edições e aos itens por ISBN com o cliente Supabase do usuário (só servidor). */

type LinhaEdicao = {
  id: string
  isbn13: string | null
  titulo: string
  serie_nome: string | null
  numero_volume: number | string | null
  tipo: 'hq' | 'manga' | null
  editora: string | null
  autores: string[] | null
  ano: number | null
  paginas: number | null
  sinopse: string | null
  capa_url_externa: string | null
  origem: EdicaoDados['origem']
}

export const COLUNAS_EDICAO =
  'id, isbn13, titulo, serie_nome, numero_volume, tipo, editora, autores, ano, paginas, sinopse, capa_url_externa, origem'

export function linhaParaEdicao(l: LinhaEdicao): EdicaoDados & { id: string } {
  return {
    id: l.id,
    isbn13: l.isbn13,
    titulo: l.titulo,
    serie_nome: l.serie_nome,
    numero_volume: l.numero_volume === null ? null : Number(l.numero_volume),
    tipo: l.tipo,
    editora: l.editora,
    autores: l.autores ?? [],
    ano: l.ano,
    paginas: l.paginas,
    sinopse: l.sinopse,
    capa_url_externa: l.capa_url_externa,
    origem: l.origem,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function catalogoSupabase(supabase: SupabaseClient<any>): CatalogoEdicoes {
  return {
    async buscar(isbn13) {
      const { data, error } = await supabase.from('edicoes').select(COLUNAS_EDICAO).eq('isbn13', isbn13).maybeSingle<LinhaEdicao>()
      if (error) throw new Error(error.message)
      return data ? linhaParaEdicao(data) : null
    },
    async registrar(edicao) {
      const { data, error } = await supabase.rpc('edicao_registrar', {
        p_dados: { ...edicao, chave_normalizada: chaveDaEdicao(edicao) },
      })
      if (error) {
        console.warn('[isbn] não gravou no catálogo:', error.message)
        return null
      }
      return data as string
    },
  }
}

export type ItemExistente = { id: string; titulo: string; estado: EstadoItem }

/** Itens do usuário com o ISBN (13 ou 10 dígitos, com ou sem hífen). */
export async function itensComIsbn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  isbn13: string
): Promise<ItemExistente[]> {
  const isbns = [isbn13, isbn13ParaIsbn10(isbn13)].filter((x): x is string => Boolean(x))
  const { data, error } = await supabase.rpc('itens_por_isbn', { p_isbns: isbns })
  if (error) throw new Error(error.message)
  return (data ?? []) as ItemExistente[]
}


type DadosDoItemParaCatalogo = {
  isbn: string | null | undefined
  titulo: string
  serieId: string | null | undefined
  numeroVolume: number | null | undefined
  tipo: 'hq' | 'manga'
  tagIds: string[]
}

/**
 * Item salvo à mão com um ISBN válido alimenta o catálogo (origem `usuario`) e fica ligado à edição.
 * Só vão dados bibliográficos (título, série, número, tipo, editora, autores): nunca preço, loja, datas,
 * nota ou crítica. `edicao_registrar` não sobrescreve edição que veio de API. Melhor esforço: não lança —
 * o item já foi salvo e o catálogo é acessório.
 */
export async function alimentarCatalogoComItem(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  itemId: string,
  dados: DadosDoItemParaCatalogo
): Promise<void> {
  try {
    const isbn13 = dados.isbn ? normalizarIsbn(dados.isbn) : null
    if (!isbn13) {
      // ISBN removido ou inválido: o item deixa de apontar para uma edição que não é mais a dele.
      await supabase.from('itens').update({ edicao_id: null }).eq('id', itemId).not('edicao_id', 'is', null)
      return
    }

    let serieNome: string | null = null
    const tagsDaSerie: { nome: string; tipo: string }[] = []
    if (dados.serieId) {
      const { data } = await supabase
        .from('series')
        .select('nome, serie_tags(tags(nome, tipo))')
        .eq('id', dados.serieId)
        .maybeSingle<{ nome: string; serie_tags: { tags: { nome: string; tipo: string } | null }[] | null }>()
      serieNome = data?.nome ?? null
      for (const st of data?.serie_tags ?? []) if (st.tags) tagsDaSerie.push(st.tags)
    }
    const tagsDoItem: { nome: string; tipo: string }[] = []
    if (dados.tagIds.length > 0) {
      const { data } = await supabase.from('tags').select('nome, tipo').in('id', dados.tagIds)
      tagsDoItem.push(...((data ?? []) as { nome: string; tipo: string }[]))
    }
    const editora = [...tagsDoItem, ...tagsDaSerie].find((t) => t.tipo === 'editora')?.nome ?? null
    const autores = Array.from(new Set(tagsDoItem.filter((t) => t.tipo === 'autor').map((t) => t.nome)))

    const edicao: EdicaoDados = {
      isbn13,
      titulo: dados.titulo,
      serie_nome: serieNome,
      numero_volume: dados.numeroVolume ?? null,
      tipo: dados.tipo,
      editora,
      autores,
      ano: null,
      paginas: null,
      sinopse: null,
      capa_url_externa: null,
      origem: 'usuario',
    }
    const { data: edicaoId, error } = await supabase.rpc('edicao_registrar', {
      p_dados: { ...edicao, chave_normalizada: chaveDaEdicao(edicao) },
    })
    if (error || !edicaoId) return
    await supabase.from('itens').update({ edicao_id: edicaoId }).eq('id', itemId)
  } catch (e) {
    console.warn('[catalogo] item não alimentou o catálogo:', e instanceof Error ? e.message : 'erro')
  }
}
