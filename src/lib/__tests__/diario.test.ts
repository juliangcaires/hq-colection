import { describe, expect, it } from 'vitest'
import { agruparPorMes, anosDoDiario, carregarDiario, dataBr, escolherAno, nomeDoMes, type EntradaDoDiario } from '@/lib/diario'

const e = (leituraId: string, lidoEm: string, extra: Partial<EntradaDoDiario> = {}): EntradaDoDiario => ({
  leituraId,
  itemId: `i-${leituraId}`,
  lidoEm,
  releitura: false,
  titulo: `T ${leituraId}`,
  numeroVolume: null,
  serieNome: null,
  tipo: 'hq',
  capaUrl: null,
  nota: null,
  ...extra,
})

describe('anos e ano escolhido', () => {
  const entradas = [e('a', '2026-03-01'), e('b', '2024-12-31'), e('c', '2026-07-01'), e('d', '2025-01-01')]
  it('anos, do mais recente ao mais antigo, sem repetir', () => {
    expect(anosDoDiario(entradas)).toEqual([2026, 2025, 2024])
    expect(anosDoDiario([])).toEqual([])
  })
  it('usa o pedido se houver leitura; senão o ano corrente; senão o mais recente', () => {
    expect(escolherAno('2025', [2026, 2025], 2026)).toBe(2025)
    expect(escolherAno('1999', [2026, 2025], 2026)).toBe(2026)
    expect(escolherAno('lixo', [2025, 2024], 2026)).toBe(2025)
    expect(escolherAno(undefined, [], 2026)).toBe(2026)
  })
})

describe('agruparPorMes', () => {
  it('só o ano pedido, meses do mais recente ao mais antigo, e dentro do mês a leitura mais recente primeiro', () => {
    const meses = agruparPorMes(
      [e('a', '2026-03-01'), e('b', '2026-03-20'), e('c', '2026-01-10'), e('d', '2025-12-31'), e('f', '2026-03-20', { titulo: 'A antes' })],
      2026
    )
    expect(meses.map((m) => m.mes)).toEqual(['2026-03', '2026-01'])
    expect(meses[0].entradas.map((x) => x.leituraId)).toEqual(['f', 'b', 'a'])
  })
  it('ano sem leitura devolve vazio', () => {
    expect(agruparPorMes([e('a', '2026-03-01')], 2030)).toEqual([])
  })
  it('a mesma obra lida duas vezes no ano aparece duas vezes', () => {
    const meses = agruparPorMes([e('a', '2026-02-01', { itemId: 'x' }), e('b', '2026-09-01', { itemId: 'x', releitura: true })], 2026)
    expect(meses.flatMap((m) => m.entradas).map((x) => [x.itemId, x.releitura])).toEqual([['x', true], ['x', false]])
  })
})

describe('nomes e datas', () => {
  it('mês por extenso e data brasileira sem mudar de dia', () => {
    expect(nomeDoMes('2026-03')).toBe('março')
    expect(nomeDoMes('2026-12')).toBe('dezembro')
    expect(dataBr('2026-03-09')).toBe('09/03/2026')
  })
})

describe('carregarDiario', () => {
  it('junta leitura e volume, marca a releitura e ignora leitura sem volume visível', async () => {
    const linhas = [
      { id: '1', item_id: 'x', lido_em: '2026-01-01', criado_em: '2026-01-01T00:00:00Z', item: { titulo: 'Berserk 1', numero_volume: '1', tipo: 'manga', capa_url: 'u/c.jpg', nota: '4.5', serie: { nome: 'Berserk' } } },
      { id: '2', item_id: 'x', lido_em: '2026-06-01', criado_em: '2026-06-01T00:00:00Z', item: { titulo: 'Berserk 1', numero_volume: '1', tipo: 'manga', capa_url: 'u/c.jpg', nota: '4.5', serie: [{ nome: 'Berserk' }] } },
      { id: '3', item_id: 'y', lido_em: '2026-02-01', criado_em: '2026-02-01T00:00:00Z', item: null },
    ]
    const supabase = { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: linhas, error: null }) }) }) }) }
    const r = await carregarDiario(supabase as never)
    expect(r.map((x) => [x.leituraId, x.releitura, x.nota, x.numeroVolume, x.serieNome])).toEqual([
      ['2', true, 4.5, 1, 'Berserk'],
      ['1', false, 4.5, 1, 'Berserk'],
    ])
  })
})
