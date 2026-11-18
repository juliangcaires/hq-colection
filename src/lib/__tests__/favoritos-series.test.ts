import { describe, expect, it } from 'vitest'
import {
  adicionarFavorito,
  buscarCandidatas,
  favoritosDaVitrine,
  LIMITE_FAVORITOS,
  moverFavorito,
  podeAdicionar,
  removerFavorito,
  seriesDoDono,
} from '../favoritos-series'

const s = (id: string, nome = id) => ({ id, nome })

describe('adicionar, remover e limite', () => {
  it('o limite é 4', () => {
    expect(LIMITE_FAVORITOS).toBe(4)
  })

  it('adiciona no fim e ignora repetida', () => {
    const lista = adicionarFavorito([s('a')], s('b'))
    expect(lista.map((x) => x.id)).toEqual(['a', 'b'])
    expect(adicionarFavorito(lista, s('a')).map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('a quinta não entra', () => {
    const quatro = [s('a'), s('b'), s('c'), s('d')]
    expect(podeAdicionar(quatro)).toBe(false)
    expect(adicionarFavorito(quatro, s('e')).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(podeAdicionar(quatro.slice(0, 3))).toBe(true)
  })

  it('remove e abre vaga; não muda a lista original', () => {
    const quatro = [s('a'), s('b'), s('c'), s('d')]
    const menos = removerFavorito(quatro, 'b')
    expect(menos.map((x) => x.id)).toEqual(['a', 'c', 'd'])
    expect(quatro).toHaveLength(4)
    expect(removerFavorito(menos, 'zzz')).toHaveLength(3)
    expect(podeAdicionar(menos)).toBe(true)
  })
})

describe('moverFavorito', () => {
  const lista = [s('a'), s('b'), s('c')]
  const ids = (l: { id: string }[]) => l.map((x) => x.id)

  it('sobe e desce uma posição', () => {
    expect(ids(moverFavorito(lista, 'b', -1))).toEqual(['b', 'a', 'c'])
    expect(ids(moverFavorito(lista, 'b', 1))).toEqual(['a', 'c', 'b'])
  })

  it('nas pontas e com id desconhecido não muda nada', () => {
    expect(ids(moverFavorito(lista, 'a', -1))).toEqual(['a', 'b', 'c'])
    expect(ids(moverFavorito(lista, 'c', 1))).toEqual(['a', 'b', 'c'])
    expect(ids(moverFavorito(lista, 'x', 1))).toEqual(['a', 'b', 'c'])
  })
})

describe('buscarCandidatas', () => {
  const todas = [s('1', 'Berserk'), s('2', 'Dragon Ball'), s('3', 'Pokémon Adventures'), s('4', 'Akira')]

  it('sem termo devolve todas; com termo ignora acento e maiúsculas', () => {
    expect(buscarCandidatas(todas, '')).toHaveLength(4)
    expect(buscarCandidatas(todas, '  ')).toHaveLength(4)
    expect(buscarCandidatas(todas, 'pokemon').map((x) => x.id)).toEqual(['3'])
    expect(buscarCandidatas(todas, 'BALL').map((x) => x.id)).toEqual(['2'])
    expect(buscarCandidatas(todas, 'zzz')).toEqual([])
  })

  it('quem já é favorito não aparece de novo', () => {
    expect(buscarCandidatas(todas, '', [s('1'), s('4')]).map((x) => x.id)).toEqual(['2', '3'])
  })
})

describe('leitura das funções SQL', () => {
  it('vitrine: ordena pela posição, limita a 4 e monta a URL da capa privada pela rota do amigo', () => {
    const arq = '11111111-2222-3333-4444-555555555555-1700000000000.jpg'
    const linhas = [
      { id: 'b', nome: 'B', tipo: 'hq', capa: arq, posicao: 2 },
      { id: 'a', nome: 'A', tipo: 'manga', capa: null, posicao: 1 },
      { id: 'c', nome: 'C', tipo: 'hq', capa: '../../etc/passwd', posicao: 3 },
    ]
    const f = favoritosDaVitrine(linhas, { tipo: 'amigo', apelido: 'ana' })
    expect(f.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(f[0].capa).toBeNull()
    expect(f[1].capa).toBe(`/amigos/ana/capa/${arq}`)
    expect(f[2].capa).toBeNull()
    expect(favoritosDaVitrine(null, { tipo: 'amigo', apelido: 'ana' })).toEqual([])
    const cinco = Array.from({ length: 5 }, (_, i) => ({ id: String(i), nome: 'x', tipo: 'hq', capa: null, posicao: i + 1 }))
    expect(favoritosDaVitrine(cinco, { tipo: 'amigo', apelido: 'ana' })).toHaveLength(4)
  })

  it('dono: capa privada vira /api/capa/<arquivo>; sem capa fica null', () => {
    const f = seriesDoDono([
      { id: 'a', nome: 'A', tipo: 'hq', capa: 'u1/arquivo.jpg', posicao: 1 },
      { id: 'b', nome: 'B', tipo: 'hq', capa: null, posicao: 2 },
    ])
    expect(f[0].capa).toBe('/api/capa/arquivo.jpg')
    expect(f[1].capa).toBeNull()
    expect(seriesDoDono(undefined)).toEqual([])
  })
})
