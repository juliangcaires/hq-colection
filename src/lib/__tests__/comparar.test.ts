import { describe, expect, it } from 'vitest'
import { compararColecoes, type ItemParaComparar, type LadoDaComparacao } from '@/lib/comparar'

const it_ = (serie: string | null, numero: number | null, extra: Partial<ItemParaComparar> = {}): ItemParaComparar => ({
  titulo: serie ? `${serie} ${numero ?? ''}`.trim() : 'Avulso',
  serie_nome: serie,
  numero_volume: numero,
  tipo: 'manga',
  isbn13: null,
  nota: null,
  ...extra,
})
const lado = (itens: ItemParaComparar[], series: LadoDaComparacao['series'] = []): LadoDaComparacao => ({ itens, series })

describe('compararColecoes', () => {
  it('acha séries em comum ignorando acento, caixa e "vol.", e diz quem tem o quê', () => {
    const eu = lado([1, 2, 3, 5].map((n) => it_('One Piece', n)))
    const ele = lado([...[1, 2, 3, 4, 6].map((n) => it_('one  PIECE', n)), it_('Sandman', 1)])
    const r = compararColecoes(eu, ele)
    expect(r.emComum).toHaveLength(1)
    expect(r.emComum[0]).toMatchObject({
      meusNumeros: [1, 2, 3, 5],
      numerosDele: [1, 2, 3, 4, 6],
      eleTemEuNao: [4, 6],
      euTenhoEleNao: [5],
    })
    expect(r.soDele).toEqual(['Sandman'])
    expect(r.soMinhas).toEqual([])
  })

  it('tipo diferente não é a mesma obra (HQ x mangá com o mesmo nome)', () => {
    const r = compararColecoes(lado([it_('Berserk', 1, { tipo: 'manga' })]), lado([it_('Berserk', 1, { tipo: 'hq' })]))
    expect(r.emComum).toHaveLength(0)
    expect(r.soMinhas).toEqual(['Berserk'])
    expect(r.soDele).toEqual(['Berserk'])
  })

  it('o catálogo liga séries com nomes diferentes pelo ISBN e o volume casa por ISBN mesmo com número diferente', () => {
    const eu = lado([it_('One Piece', 1, { isbn13: '9788545702870' }), it_('One Piece', 2)])
    const ele = lado([it_('One Piece (Panini)', 10, { isbn13: '9788545702870' }), it_('One Piece (Panini)', 3)])
    const r = compararColecoes(eu, ele)
    expect(r.livrosIguais).toBe(1)
    expect(r.emComum).toHaveLength(1)
    expect(r.emComum[0].meuNome).toBe('One Piece')
    expect(r.emComum[0].nomeDele).toBe('One Piece (Panini)')
    // o #1 meu é o mesmo livro que o #10 dele: não conta como faltante nem de um lado nem do outro
    expect(r.emComum[0].eleTemEuNao).toEqual([3])
    expect(r.emComum[0].euTenhoEleNao).toEqual([2])
  })

  it('volumes sem número são contados à parte', () => {
    const eu = lado([it_('Hellboy', 1)])
    const ele = lado([it_('Hellboy', 1), it_('Hellboy', null), it_('Hellboy', null, { titulo: 'Especial' })])
    const [s] = compararColecoes(eu, ele).emComum
    expect(s.eleTemEuNao).toEqual([])
    expect(s.semNumeroEleTem).toBe(2)
  })

  it('notas lado a lado: da série e dos volumes lidos que os dois avaliaram', () => {
    const eu = lado([it_('Monster', 1, { nota: 5 }), it_('Monster', 2, { nota: 4 }), it_('Monster', 3)], [{ nome: 'Monster', tipo: 'manga', nota: 4.5 }])
    const ele = lado([it_('Monster', 1, { nota: 3.5 }), it_('Monster', 2), it_('Monster', 3, { nota: 2 })], [{ nome: 'Monster', tipo: 'manga', nota: null }])
    const [s] = compararColecoes(eu, ele).emComum
    expect(s.notaMinha).toBe(4.5)
    expect(s.notaDele).toBeNull()
    expect(s.notasPorVolume).toEqual([{ numero: 1, titulo: 'Monster 1', minha: 5, dele: 3.5 }]) // só onde os dois avaliaram
  })

  it('livros avulsos entram só na contagem por ISBN; coleções vazias não quebram', () => {
    const eu = lado([it_(null, null, { isbn13: '9791032305843' })])
    const ele = lado([it_(null, null, { isbn13: '9791032305843' })])
    expect(compararColecoes(eu, ele)).toEqual({ emComum: [], soMinhas: [], soDele: [], livrosIguais: 1 })
    expect(compararColecoes(lado([]), lado([]))).toEqual({ emComum: [], soMinhas: [], soDele: [], livrosIguais: 0 })
  })

  it('ordena por nome e não duplica ao ter vários volumes', () => {
    const eu = lado([it_('Zeta', 1), it_('Alfa', 1), it_('Alfa', 1)])
    const ele = lado([it_('Zeta', 1), it_('Alfa', 2)])
    const r = compararColecoes(eu, ele)
    expect(r.emComum.map((s) => s.meuNome)).toEqual(['Alfa', 'Zeta'])
    expect(r.emComum[0].meusNumeros).toEqual([1])
  })
})
