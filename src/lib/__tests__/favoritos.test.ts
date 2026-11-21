import { describe, expect, it } from 'vitest'
import {
  adicionarFavorito,
  buscarCandidatas,
  favoritosDaVitrine,
  LIMITE_FAVORITOS,
  moverFavorito,
  podeAdicionar,
  removerFavorito,
  favoritosDoDono,
  paraSalvar,
  ROTULO_DA_ORIGEM,
} from '../favoritos'

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

  it('a origem vem do banco: avulso é volume único; sem origem (função antiga) é série', () => {
    const fonte = { tipo: 'amigo', apelido: 'ana' } as const
    const f = favoritosDaVitrine(
      [
        { origem: 'avulso', id: 'i', nome: 'Batman: Silêncio 2', tipo: 'hq', capa: null, posicao: 1 },
        { origem: 'serie', id: 's', nome: 'Berserk', tipo: 'manga', capa: null, posicao: 2 },
        { id: 'x', nome: 'Antiga', tipo: 'hq', capa: null, posicao: 3 },
        { origem: 'qualquer', id: 'y', nome: 'Estranha', tipo: 'hq', capa: null, posicao: 4 },
      ],
      fonte
    )
    expect(f.map((x) => x.origem)).toEqual(['avulso', 'serie', 'serie', 'serie'])
    expect(favoritosDoDono([{ origem: 'avulso', id: 'i', nome: 'N', tipo: 'hq', capa: null, posicao: 1 }])[0].origem).toBe('avulso')
  })

  it('dono: capa privada vira /api/capa/<arquivo>; sem capa fica null', () => {
    const f = favoritosDoDono([
      { id: 'a', nome: 'A', tipo: 'hq', capa: 'u1/arquivo.jpg', posicao: 1 },
      { id: 'b', nome: 'B', tipo: 'hq', capa: null, posicao: 2 },
    ])
    expect(f[0].capa).toBe('/api/capa/arquivo.jpg')
    expect(f[1].capa).toBeNull()
    expect(favoritosDoDono(undefined)).toEqual([])
  })
})

describe('mistura de séries e avulsos', () => {
  const serie = (id: string) => ({ origem: 'serie' as const, id, nome: id })
  const avulso = (id: string) => ({ origem: 'avulso' as const, id, nome: id })

  it('o limite de 4 vale no total, qualquer que seja a mistura', () => {
    const tres = [serie('s1'), avulso('a1'), serie('s2')]
    expect(podeAdicionar(tres)).toBe(true)
    const quatro = adicionarFavorito(tres, avulso('a2'))
    expect(quatro.map((x) => x.id)).toEqual(['s1', 'a1', 's2', 'a2'])
    expect(podeAdicionar(quatro)).toBe(false)
    expect(adicionarFavorito(quatro, serie('s3'))).toHaveLength(4)
    expect(adicionarFavorito(quatro, avulso('a3'))).toHaveLength(4)
  })

  it('reordena e remove sem distinguir o tipo', () => {
    const lista = [avulso('a1'), serie('s1'), avulso('a2')]
    expect(moverFavorito(lista, 'a2', -1).map((x) => x.id)).toEqual(['a1', 'a2', 's1'])
    expect(removerFavorito(lista, 's1').map((x) => x.id)).toEqual(['a1', 'a2'])
  })

  it('a busca acha série e volume único pelo nome, sem acento', () => {
    const todos = [{ ...serie('s1'), nome: 'Batman' }, { ...avulso('a1'), nome: 'Batman: Silêncio 2 - Edição Encadernada' }, { ...avulso('a2'), nome: 'Maus' }]
    expect(buscarCandidatas(todos, 'silencio').map((x) => x.id)).toEqual(['a1'])
    expect(buscarCandidatas(todos, 'batman').map((x) => x.id)).toEqual(['s1', 'a1'])
    expect(buscarCandidatas(todos, 'batman', [todos[0]]).map((x) => x.id)).toEqual(['a1'])
  })

  it('para gravar: série vira "serie" e volume único vira "item", na ordem', () => {
    expect(paraSalvar([avulso('a1'), serie('s1')])).toEqual([{ tipo: 'item', id: 'a1' }, { tipo: 'serie', id: 's1' }])
    expect(paraSalvar([])).toEqual([])
  })

  it('rótulos do tipo', () => {
    expect(ROTULO_DA_ORIGEM).toEqual({ serie: 'Série', avulso: 'Volume único' })
  })
})
