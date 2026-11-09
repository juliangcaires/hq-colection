'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'
import { normalizarIsbn } from '@/lib/isbn'
import { buscarEdicaoPorIsbn, type ResultadoBuscaIsbn } from '@/lib/isbn-busca'
import { catalogoSupabase, itensComIsbn, type ItemExistente } from '@/lib/isbn-supabase'

/** Chamadas externas por usuário por hora (a resposta do catálogo interno não conta). */
const LIMITE_CONSULTAS_POR_HORA = 60

export type ConsultaIsbn = {
  isbn13: string
  /** Itens do usuário com este ISBN (aviso "Você já tem este volume"). */
  jaNaColecao: ItemExistente[]
  resultado: ResultadoBuscaIsbn
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

  return { isbn13, jaNaColecao, resultado }
}

export async function consultarIsbn(entrada: string) {
  return executar(() => consultarIsbnImpl(entrada))
}
