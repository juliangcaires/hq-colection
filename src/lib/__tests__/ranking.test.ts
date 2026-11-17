import { describe, expect, it } from 'vitest'
import {
  anosDeLeitura,
  filtrarSemNota,
  histogramaDeNotas,
  intervaloDoPeriodo,
  lerFiltrosRanking,
  ordenarRanking,
  type FiltrosRanking,
  type LinhaDoRanking,
} from '../ranking'

const base = (o: Partial<LinhaDoRanking>): LinhaDoRanking => ({
  id: 'a', titulo: 'A', nota: 3, critica: null, lido_em: null, updated_at: '2026-01-01T00:00:00Z',
  numero_volume: null, serie_id: null, serie_nome: null, tagIds: [], ...o,
})
const filtros = (o: Partial<FiltrosRanking> = {}): FiltrosRanking => ({ ordem: 'nota', comCritica: false, ...o })
const hoje = new Date(2026, 10, 17)

describe('lerFiltrosRanking', () => {
  it('usa padrões e ignora lixo', () => {
    expect(lerFiltrosRanking({ ordem: 'x', periodo: 'abc', nota: '7', tag: 'nao-uuid' })).toEqual({
      tipo: undefined, ordem: 'nota', periodo: undefined, tagId: undefined, serieId: undefined, comCritica: false, nota: undefined,
    })
  })
  it('lê valores válidos (nota com vírgula)', () => {
    const f = lerFiltrosRanking({ ordem: 'serie', periodo: '2025', nota: '4,5', critica: '1', tipo: 'manga' })
    expect(f).toMatchObject({ ordem: 'serie', periodo: '2025', nota: 4.5, comCritica: true, tipo: 'manga' })
    expect(lerFiltrosRanking({ nota: '4.3' }).nota).toBeUndefined()
  })
})

describe('intervaloDoPeriodo', () => {
  it('cobre sempre, este ano, 12 meses e ano', () => {
    expect(intervaloDoPeriodo(undefined, hoje)).toBeNull()
    expect(intervaloDoPeriodo('este-ano', hoje)).toEqual({ desde: '2026-01-01', ate: '2026-12-31' })
    expect(intervaloDoPeriodo('12m', hoje)).toEqual({ desde: '2025-11-17', ate: '2026-11-17' })
    expect(intervaloDoPeriodo('2024', hoje)).toEqual({ desde: '2024-01-01', ate: '2024-12-31' })
  })
})

describe('filtrarSemNota', () => {
  const linhas = [
    base({ id: '1', lido_em: '2026-03-01', critica: 'bom', tagIds: ['t1'], serie_id: 's1' }),
    base({ id: '2', lido_em: '2025-03-01', critica: '  ', tagIds: ['t2'] }),
    base({ id: '3', lido_em: null }),
  ]
  it('período exclui sem data e fora do ano', () => {
    expect(filtrarSemNota(linhas, filtros({ periodo: 'este-ano' }), hoje).map((l) => l.id)).toEqual(['1'])
    expect(filtrarSemNota(linhas, filtros({ periodo: '2025' }), hoje).map((l) => l.id)).toEqual(['2'])
  })
  it('tag, série e crítica (só espaços não conta)', () => {
    expect(filtrarSemNota(linhas, filtros({ tagId: 't2' }), hoje).map((l) => l.id)).toEqual(['2'])
    expect(filtrarSemNota(linhas, filtros({ serieId: 's1' }), hoje).map((l) => l.id)).toEqual(['1'])
    expect(filtrarSemNota(linhas, filtros({ comCritica: true }), hoje).map((l) => l.id)).toEqual(['1'])
  })
})

describe('ordenarRanking', () => {
  it('nota desc, desempate por leitura mais recente', () => {
    const r = ordenarRanking(
      [base({ id: 'a', nota: 4, lido_em: '2025-01-01' }), base({ id: 'b', nota: 5 }), base({ id: 'c', nota: 4, lido_em: '2026-01-01' })],
      'nota'
    )
    expect(r.map((l) => l.id)).toEqual(['b', 'c', 'a'])
  })
  it('leitura: recente primeiro, sem data no fim', () => {
    const r = ordenarRanking(
      [base({ id: 'a' }), base({ id: 'b', lido_em: '2024-01-01' }), base({ id: 'c', lido_em: '2026-01-01' })],
      'leitura'
    )
    expect(r.map((l) => l.id)).toEqual(['c', 'b', 'a'])
  })
  it('série: por nome e volume, sem série por último', () => {
    const r = ordenarRanking(
      [
        base({ id: 'x', titulo: 'Solto' }),
        base({ id: 'b2', serie_nome: 'Berserk', numero_volume: 2 }),
        base({ id: 'b1', serie_nome: 'Berserk', numero_volume: 1 }),
        base({ id: 'a1', serie_nome: 'Akira', numero_volume: 1 }),
      ],
      'serie'
    )
    expect(r.map((l) => l.id)).toEqual(['a1', 'b1', 'b2', 'x'])
  })
})

describe('histogramaDeNotas / anosDeLeitura', () => {
  it('10 barras de meia estrela', () => {
    const h = histogramaDeNotas([{ nota: 0.5 }, { nota: 4.5 }, { nota: 4.5 }, { nota: 5 }])
    expect(h).toHaveLength(10)
    expect(h[0]).toEqual({ nota: 0.5, quantidade: 1 })
    expect(h[8]).toEqual({ nota: 4.5, quantidade: 2 })
    expect(h[9]).toEqual({ nota: 5, quantidade: 1 })
  })
  it('anos distintos, mais recente primeiro', () => {
    expect(anosDeLeitura([{ lido_em: '2024-02-01' }, { lido_em: '2026-01-01' }, { lido_em: '2024-05-05' }, { lido_em: null }])).toEqual([2026, 2024])
  })
})
