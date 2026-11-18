import type { SupabaseClient } from '@supabase/supabase-js'
import { FUSO_DO_APP, hojeIso } from '@/lib/datas'
import {
  anosComLeitura,
  anosDoSeletor,
  calcularEstatisticasDoAno,
  carregarDadosParaEstatisticas,
  escolherAnoDasEstatisticas,
  type EstatisticasDoAno,
} from '@/lib/estatisticas'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

/** Carga comum das duas telas: dados, ano escolhido pela URL, anos do seletor e as contas do ano. */
export async function carregarEstatisticasDaPagina(
  supabase: Cliente,
  pedido: string | string[] | undefined
): Promise<{ ano: number; anos: number[]; semNenhumaLeitura: boolean; estatisticas: EstatisticasDoAno; minhasNotasDoAno: Map<string, number> }> {
  const dados = await carregarDadosParaEstatisticas(supabase)
  const anosDeDados = anosComLeitura(dados.leituras)
  const anoAtual = Number(hojeIso(FUSO_DO_APP).slice(0, 4))
  const ano = escolherAnoDasEstatisticas(Array.isArray(pedido) ? pedido[0] : pedido, anosDeDados, anoAtual)
  const estatisticas = calcularEstatisticasDoAno(dados, ano)

  const minhasNotasDoAno = new Map<string, number>()
  const idsDoAno = new Set(dados.leituras.filter((l) => l.lidoEm.startsWith(`${ano}-`)).map((l) => l.itemId))
  for (const v of dados.volumes) if (idsDoAno.has(v.id) && v.nota !== null) minhasNotasDoAno.set(v.id, v.nota)

  return {
    ano,
    anos: anosDoSeletor(anosDeDados, anoAtual, ano),
    semNenhumaLeitura: anosDeDados.length === 0,
    estatisticas,
    minhasNotasDoAno,
  }
}
