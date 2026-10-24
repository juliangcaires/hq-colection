import { z } from 'zod'
import { TIPOS_TAG_DEDICADOS } from '@/lib/tags-por-tipo'
import type { FiltrosItens } from '@/lib/queries'
import type { TipoTag } from '@/lib/types'

const uuid = z.string().uuid()
const tipoObra = z.enum(['hq', 'manga'])
const estadoItem = z.enum(['desejo', 'comprado', 'lido'])

/** Id válido ou `null` (para `/item/abc` virar 404 em vez de erro do banco). */
export function uuidOuNull(valor: string | undefined): string | null {
  const r = uuid.safeParse(valor)
  return r.success ? r.data : null
}

/**
 * Lê os filtros de `?estado=…&tipo=…` da URL. Valor inválido é IGNORADO (a lista aparece sem
 * aquele filtro) em vez de derrubar a página com HTTP 500 por causa de um link digitado errado.
 */
export function lerFiltrosDaUrl(params: Record<string, string | undefined>): FiltrosItens {
  const tagsPorTipo: Partial<Record<TipoTag, string[]>> = {}
  for (const { tipo } of TIPOS_TAG_DEDICADOS) {
    const ids = (params[tipo] ?? '')
      .split(',')
      .filter((id) => uuid.safeParse(id).success)
      .slice(0, 50)
    if (ids.length > 0) tagsPorTipo[tipo] = ids
  }

  return {
    estado: estadoItem.safeParse(params.estado).data,
    tipo: tipoObra.safeParse(params.tipo).data,
    serieId: uuidOuNull(params.serie) ?? undefined,
    busca: params.busca?.trim().slice(0, 100) || undefined,
    semCapa: params.capa === 'sem',
    tagsPorTipo,
  }
}

export const ITENS_POR_PAGINA = 60
const LIMITE_MAXIMO = 3000

/** `?limite=` do "carregar mais": inteiro entre uma página e o teto; qualquer outra coisa vale uma página. */
export function lerLimite(valor: string | undefined): number {
  const n = Number(valor)
  if (!Number.isInteger(n) || n < ITENS_POR_PAGINA) return ITENS_POR_PAGINA
  return Math.min(n, LIMITE_MAXIMO)
}
