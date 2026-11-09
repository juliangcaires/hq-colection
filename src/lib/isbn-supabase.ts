import type { SupabaseClient } from '@supabase/supabase-js'
import { isbn13ParaIsbn10 } from '@/lib/isbn'
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

