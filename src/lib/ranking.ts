import { z } from 'zod'

export const ORDENS_RANKING = ['nota', 'leitura', 'serie'] as const
export type OrdemRanking = (typeof ORDENS_RANKING)[number]

export type FiltrosRanking = {
  tipo?: 'hq' | 'manga'
  ordem: OrdemRanking
  /** `este-ano`, `12m` ou um ano (`2025`); `undefined` = sempre. */
  periodo?: string
  tagId?: string
  serieId?: string
  comCritica: boolean
  /** Nota exata (0,5 a 5, meia estrela) vinda do clique no histograma. */
  nota?: number
}

const uuid = z.string().uuid()

/** Nota válida de meia estrela (0,5 … 5) ou `undefined`. */
export function lerNotaDaUrl(valor: string | undefined): number | undefined {
  if (!valor) return undefined
  const n = Number(valor.replace(',', '.'))
  return Number.isFinite(n) && n >= 0.5 && n <= 5 && Number.isInteger(n * 2) ? n : undefined
}

export function lerPeriodoDaUrl(valor: string | undefined): string | undefined {
  if (valor === 'este-ano' || valor === '12m') return valor
  return /^(19|20)\d{2}$/.test(valor ?? '') ? valor : undefined
}

/** Valores inválidos são ignorados (link digitado errado não derruba a página). */
export function lerFiltrosRanking(params: Record<string, string | undefined>): FiltrosRanking {
  return {
    tipo: params.tipo === 'hq' || params.tipo === 'manga' ? params.tipo : undefined,
    ordem: (ORDENS_RANKING as readonly string[]).includes(params.ordem ?? '') ? (params.ordem as OrdemRanking) : 'nota',
    periodo: lerPeriodoDaUrl(params.periodo),
    tagId: uuid.safeParse(params.tag).data,
    serieId: uuid.safeParse(params.serie).data,
    comCritica: params.critica === '1',
    nota: lerNotaDaUrl(params.nota),
  }
}

export type LinhaDoRanking = {
  id: string
  titulo: string
  nota: number
  critica: string | null
  lido_em: string | null
  updated_at: string
  numero_volume: number | null
  serie_id: string | null
  serie_nome: string | null
  /** Melhor volume da série (0030): só desempata notas iguais, na ordem `nota`. */
  melhor_da_serie: boolean
  /** Tags do item e da série (ids). */
  tagIds: string[]
}

/** O período vira intervalo `[desde, ate]` em `AAAA-MM-DD` (inclusive); `null` = sem limite. */
export function intervaloDoPeriodo(periodo: string | undefined, hoje: Date): { desde: string; ate: string } | null {
  if (!periodo) return null
  const ano = hoje.getFullYear()
  if (periodo === 'este-ano') return { desde: `${ano}-01-01`, ate: `${ano}-12-31` }
  if (periodo === '12m') {
    const d = new Date(hoje)
    d.setFullYear(d.getFullYear() - 1)
    return { desde: iso(d), ate: iso(hoje) }
  }
  return { desde: `${periodo}-01-01`, ate: `${periodo}-12-31` }
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Todos os filtros, menos a nota (para o histograma mostrar a distribuição do recorte atual). */
export function filtrarSemNota(linhas: LinhaDoRanking[], f: FiltrosRanking, hoje: Date): LinhaDoRanking[] {
  const intervalo = intervaloDoPeriodo(f.periodo, hoje)
  return linhas.filter((l) => {
    if (intervalo) {
      const dia = l.lido_em?.slice(0, 10)
      if (!dia || dia < intervalo.desde || dia > intervalo.ate) return false
    }
    if (f.tagId && !l.tagIds.includes(f.tagId)) return false
    if (f.serieId && l.serie_id !== f.serieId) return false
    if (f.comCritica && !l.critica?.trim()) return false
    return true
  })
}

const porTitulo = (a: LinhaDoRanking, b: LinhaDoRanking) =>
  a.titulo.localeCompare(b.titulo, 'pt-BR') || a.id.localeCompare(b.id)

/** Mais recente primeiro; sem data vai para o fim. */
const maisRecente = (a: string | null, b: string | null) => (b ?? '').localeCompare(a ?? '')

export function ordenarRanking(linhas: LinhaDoRanking[], ordem: OrdemRanking): LinhaDoRanking[] {
  const copia = [...linhas]
  const desempate = (a: LinhaDoRanking, b: LinhaDoRanking) =>
    maisRecente(a.lido_em, b.lido_em) || b.updated_at.localeCompare(a.updated_at) || porTitulo(a, b)
  if (ordem === 'leitura') {
    return copia.sort((a, b) => maisRecente(a.lido_em, b.lido_em) || b.nota - a.nota || porTitulo(a, b))
  }
  if (ordem === 'serie') {
    return copia.sort((a, b) => {
      // sem série por último
      if (!a.serie_nome !== !b.serie_nome) return a.serie_nome ? -1 : 1
      return (
        (a.serie_nome ?? '').localeCompare(b.serie_nome ?? '', 'pt-BR') ||
        (a.numero_volume ?? Infinity) - (b.numero_volume ?? Infinity) ||
        porTitulo(a, b)
      )
    })
  }
  // Nota primeiro (uma nota maior nunca fica atrás); entre notas iguais, o marcado como melhor da série vem antes.
  return copia.sort((a, b) => b.nota - a.nota || Number(b.melhor_da_serie) - Number(a.melhor_da_serie) || desempate(a, b))
}

export type BarraDoHistograma = { nota: number; quantidade: number }

/** 10 barras: 0,5 · 1 · … · 5. */
export function histogramaDeNotas(linhas: { nota: number }[]): BarraDoHistograma[] {
  const barras = Array.from({ length: 10 }, (_, i) => ({ nota: (i + 1) / 2, quantidade: 0 }))
  for (const { nota } of linhas) {
    const i = Math.round(nota * 2) - 1
    if (i >= 0 && i < 10) barras[i].quantidade++
  }
  return barras
}

/** Anos distintos de `lido_em`, do mais recente ao mais antigo (para o seletor de período). */
export function anosDeLeitura(linhas: Pick<LinhaDoRanking, 'lido_em'>[]): number[] {
  const anos = new Set<number>()
  for (const l of linhas) if (l.lido_em) anos.add(Number(l.lido_em.slice(0, 4)))
  return [...anos].filter((a) => a > 1900).sort((a, b) => b - a)
}
