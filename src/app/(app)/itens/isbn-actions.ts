'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'
import { normalizarIsbn } from '@/lib/isbn'
import { buscarEdicaoPorIsbn, type ResultadoBuscaIsbn } from '@/lib/isbn-busca'
import { casarAutores, casarEditora, casarSerie, LIMIAR_SERIE_AUTOMATICA, type AutorSugerido, type EditoraSugerida, type SerieSugerida } from '@/lib/casamento'
import { lerTodasAsLinhas } from '@/lib/paginar'
import { catalogoSupabase, itensComIsbn, type ItemExistente } from '@/lib/isbn-supabase'

/** Chamadas externas por usuário por hora (a resposta do catálogo interno não conta). */
const LIMITE_CONSULTAS_POR_HORA = 60

/** O que o app propõe a partir dos dados do usuário; a tela mostra tudo como sugestão a confirmar. */
export type SugestoesIsbn = {
  /** Séries existentes parecidas (a primeira vem pré-selecionada só se `serieAutomatica`). */
  series: SerieSugerida[]
  serieAutomatica: boolean
  /** Nome para criar uma série nova (extraído do título), se o usuário preferir. */
  serieNovaNome: string | null
  editora: EditoraSugerida
  autores: AutorSugerido[]
}

export type ConsultaIsbn = {
  isbn13: string
  /** Itens do usuário com este ISBN (aviso "Você já tem este volume"). */
  jaNaColecao: ItemExistente[]
  resultado: ResultadoBuscaIsbn
  /** Só quando a edição foi encontrada. */
  sugestoes: SugestoesIsbn | null
}

const isbnSchema = z.string().trim().min(1, 'Informe o ISBN').max(40, 'ISBN longo demais')

async function consultarIsbnImpl(entrada: string): Promise<ConsultaIsbn> {
  const bruto = isbnSchema.parse(entrada)
  // Valida antes de qualquer chamada: ISBN inválido não gasta nem o banco.
  const isbn13 = normalizarIsbn(bruto)
  if (!isbn13) throw new ErroDeNegocio('ISBN inválido. Confira os dígitos (10 ou 13).')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const jaNaColecao = await itensComIsbn(supabase, isbn13)

  const resultado = await buscarEdicaoPorIsbn(isbn13, {
    catalogo: catalogoSupabase(supabase),
    permitirExterno: async () => {
      const { data, error } = await supabase.rpc('isbn_consulta_registrar', { p_limite: LIMITE_CONSULTAS_POR_HORA })
      if (error) throw new Error(error.message)
      return data === true
    },
  })

  if (resultado.status === 'indisponivel' && resultado.motivo === 'limite') {
    throw new ErroDeNegocio('Muitas consultas seguidas. Espere um pouco ou cadastre manualmente.')
  }

  if (resultado.status !== 'ok') return { isbn13, jaNaColecao, resultado, sugestoes: null }

  const e = resultado.edicao
  const [series, tagsEditora, tagsAutor] = await Promise.all([
    lerTodasAsLinhas((de, ate) => supabase.from('series').select('id, nome').order('nome').order('id').range(de, ate)),
    supabase.from('tags').select('id, nome').eq('tipo', 'editora').limit(500),
    supabase.from('tags').select('id, nome').eq('tipo', 'autor').limit(1000),
  ])
  const sugeridas = casarSerie([e.serie_nome, e.titulo], series as { id: string; nome: string }[])
  const sugestoes: SugestoesIsbn = {
    series: sugeridas,
    serieAutomatica: (sugeridas[0]?.pontuacao ?? 0) >= LIMIAR_SERIE_AUTOMATICA,
    serieNovaNome: e.serie_nome,
    editora: casarEditora(e.editora, tagsEditora.data ?? []),
    autores: casarAutores(e.autores, tagsAutor.data ?? []),
  }
  return { isbn13, jaNaColecao, resultado, sugestoes }
}

export async function consultarIsbn(entrada: string) {
  return executar(() => consultarIsbnImpl(entrada))
}
