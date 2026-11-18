import type { SupabaseClient } from '@supabase/supabase-js'
import { lerTodasAsLinhas } from '@/lib/paginar'
import { marcarReleituras } from '@/lib/leituras'
import type { TipoObra } from '@/lib/types'

/** Diário de leitura (migration 0025): as leituras da pessoa, por mês e por ano. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

export type EntradaDoDiario = {
  leituraId: string
  itemId: string
  /** AAAA-MM-DD */
  lidoEm: string
  releitura: boolean
  titulo: string
  numeroVolume: number | null
  serieNome: string | null
  tipo: TipoObra
  capaUrl: string | null
  nota: number | null
}

export type MesDoDiario = { mes: string; entradas: EntradaDoDiario[] }

type LinhaCrua = {
  id: string
  item_id: string
  lido_em: string
  criado_em: string
  item: {
    titulo: string
    numero_volume: number | string | null
    tipo: TipoObra
    capa_url: string | null
    nota: number | string | null
    serie: { nome: string } | { nome: string }[] | null
  } | null
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/** Todas as leituras da pessoa com os dados do volume (RLS: só as dela), da mais recente para a mais antiga. */
export async function carregarDiario(supabase: Cliente): Promise<EntradaDoDiario[]> {
  const linhas = await lerTodasAsLinhas<LinhaCrua>(
    (de, ate) =>
      supabase
        .from('leituras')
        .select('id, item_id, lido_em, criado_em, item:itens(titulo, numero_volume, tipo, capa_url, nota, serie:series(nome))')
        .order('id')
        .range(de, ate) as unknown as PromiseLike<{ data: LinhaCrua[] | null; error: { message: string } | null }>
  )
  return marcarReleituras(linhas)
    .filter((l) => l.item)
    .map((l) => {
      const serie = Array.isArray(l.item!.serie) ? l.item!.serie[0] : l.item!.serie
      return {
        leituraId: l.id,
        itemId: l.item_id,
        lidoEm: l.lido_em,
        releitura: l.releitura,
        titulo: l.item!.titulo,
        numeroVolume: num(l.item!.numero_volume),
        serieNome: serie?.nome ?? null,
        tipo: l.item!.tipo,
        capaUrl: l.item!.capa_url,
        nota: num(l.item!.nota),
      }
    })
}

/** Anos com leitura, do mais recente ao mais antigo. */
export function anosDoDiario(entradas: Pick<EntradaDoDiario, 'lidoEm'>[]): number[] {
  return [...new Set(entradas.map((e) => Number(e.lidoEm.slice(0, 4))))].sort((a, b) => b - a)
}

/** Ano mostrado: o pedido, se houver leitura nele; senão o do ano corrente; senão o mais recente com leitura. */
export function escolherAno(pedido: string | undefined, anos: number[], anoAtual: number): number {
  const p = Number(pedido)
  if (Number.isInteger(p) && anos.includes(p)) return p
  if (anos.includes(anoAtual)) return anoAtual
  return anos[0] ?? anoAtual
}

/** Entradas do ano agrupadas por mês (AAAA-MM), do mais recente ao mais antigo; dentro do mês, a leitura mais recente primeiro. */
export function agruparPorMes(entradas: EntradaDoDiario[], ano: number): MesDoDiario[] {
  const meses = new Map<string, EntradaDoDiario[]>()
  const doAno = entradas
    .filter((e) => e.lidoEm.startsWith(`${ano}-`))
    .sort((a, b) => b.lidoEm.localeCompare(a.lidoEm) || a.titulo.localeCompare(b.titulo, 'pt-BR') || a.leituraId.localeCompare(b.leituraId))
  for (const e of doAno) {
    const mes = e.lidoEm.slice(0, 7)
    meses.set(mes, [...(meses.get(mes) ?? []), e])
  }
  return [...meses].map(([mes, lista]) => ({ mes, entradas: lista }))
}

const NOMES_DOS_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "2026-03" -> "março". */
export function nomeDoMes(mes: string): string {
  return NOMES_DOS_MESES[Number(mes.slice(5, 7)) - 1] ?? mes
}

/** "2026-03-09" -> "09/03/2026" (sem passar por Date: não muda de dia por fuso). */
export function dataBr(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}
