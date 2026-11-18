import { describe, expect, it } from 'vitest'
import {
  agruparDesejosPorSerie,
  lerOrdemDesejos,
  ordenarDesejos,
  type DesejoAgrupavel,
} from '@/lib/desejos-agrupados'

type Serie = NonNullable<DesejoAgrupavel['serie']>

const onePiece: Serie = { id: 's-op', nome: 'One Piece', tipo: 'manga', tem_numeracao: true }
const invencivel: Serie = { id: 's-inv', nome: 'Invencível', tipo: 'hq', tem_numeracao: true }
const saga: Serie = { id: 's-saga', nome: 'Saga', tipo: 'hq', tem_numeracao: true }
const sandman: Serie = { id: 's-sand', nome: 'Sandman', tipo: 'hq', tem_numeracao: false }

let n = 0
function d(titulo: string, serie: Serie | null, extra: Partial<DesejoAgrupavel> = {}): DesejoAgrupavel {
  n += 1
  return { id: `i${n}`, titulo, prioridade: 0, preco: null, numero_volume: null, serie, ...extra }
}

describe('agruparDesejosPorSerie', () => {
  it('lista vazia não gera grupo', () => {
    expect(agruparDesejosPorSerie([])).toEqual([])
  })

  it('ordena os grupos pela série com mais desejos primeiro', () => {
    const grupos = agruparDesejosPorSerie([
      d('Saga 1', saga, { numero_volume: 1 }),
      d('OP 1', onePiece, { numero_volume: 1 }),
      d('OP 2', onePiece, { numero_volume: 2 }),
      d('OP 3', onePiece, { numero_volume: 3 }),
      d('Inv 1', invencivel, { numero_volume: 1 }),
      d('Inv 2', invencivel, { numero_volume: 2 }),
    ])
    expect(grupos.map((g) => g.nome)).toEqual(['One Piece', 'Invencível', 'Saga'])
    expect(grupos.map((g) => g.itens.length)).toEqual([3, 2, 1])
  })

  it('desempata pelo nome A–Z (sem diferenciar acento e caixa)', () => {
    const grupos = agruparDesejosPorSerie([
      d('Saga 1', saga),
      d('Inv 1', invencivel),
      d('OP 1', onePiece),
      d('Sand 1', sandman),
    ])
    expect(grupos.map((g) => g.nome)).toEqual(['Invencível', 'One Piece', 'Saga', 'Sandman'])
  })

  it('Avulsos fica por último mesmo sendo o maior grupo, sem serieId nem tipo', () => {
    const grupos = agruparDesejosPorSerie([
      d('Solto 1', null),
      d('Solto 2', null),
      d('Solto 3', null),
      d('OP 1', onePiece),
    ])
    expect(grupos.map((g) => g.nome)).toEqual(['One Piece', 'Avulsos'])
    const avulsos = grupos[1]
    expect(avulsos.serieId).toBeNull()
    expect(avulsos.tipo).toBeNull()
    expect(avulsos.itens).toHaveLength(3)
  })

  it('série numerada: volumes em ordem crescente, sem número por último', () => {
    const [grupo] = agruparDesejosPorSerie([
      d('OP 10', onePiece, { numero_volume: 10 }),
      d('OP especial', onePiece),
      d('OP 2', onePiece, { numero_volume: 2 }),
    ])
    expect(grupo.itens.map((i) => i.titulo)).toEqual(['OP 2', 'OP 10', 'OP especial'])
  })

  it('série sem numeração: mantém a ordem recebida (a ordenação escolhida)', () => {
    const [grupo] = agruparDesejosPorSerie([
      d('Sandman C', sandman, { numero_volume: 9 }),
      d('Sandman A', sandman, { numero_volume: 1 }),
      d('Sandman B', sandman, { numero_volume: 5 }),
    ])
    expect(grupo.itens.map((i) => i.titulo)).toEqual(['Sandman C', 'Sandman A', 'Sandman B'])
  })

  it('carrega serieId, nome e tipo da série; e não perde nenhum item', () => {
    const itens = [d('OP 1', onePiece), d('Inv 1', invencivel), d('Solto', null)]
    const grupos = agruparDesejosPorSerie(itens)
    expect(grupos[0]).toMatchObject({ serieId: 's-inv', nome: 'Invencível', tipo: 'hq' })
    expect(grupos.flatMap((g) => g.itens)).toHaveLength(itens.length)
  })
})

describe('ordenarDesejos', () => {
  it('preço: do mais caro ao mais barato, sem preço por último', () => {
    const r = ordenarDesejos(
      [d('a', null, { preco: null }), d('b', null, { preco: 10 }), d('c', null, { preco: 50 })],
      'preco'
    )
    expect(r.map((i) => i.titulo)).toEqual(['c', 'b', 'a'])
  })

  it('série: nome A–Z, volume crescente e Avulsos por último', () => {
    const r = ordenarDesejos(
      [
        d('Solto', null),
        d('Saga 2', saga, { numero_volume: 2 }),
        d('OP 2', onePiece, { numero_volume: 2 }),
        d('Saga 1', saga, { numero_volume: 1 }),
        d('OP 1', onePiece, { numero_volume: 1 }),
      ],
      'serie'
    )
    expect(r.map((i) => i.titulo)).toEqual(['OP 1', 'OP 2', 'Saga 1', 'Saga 2', 'Solto'])
  })

  it('prioridade e recentes preservam a ordem recebida e não mutam a entrada', () => {
    const entrada = [d('x', null), d('y', null), d('z', null)]
    const copia = [...entrada]
    expect(ordenarDesejos(entrada, 'prioridade').map((i) => i.titulo)).toEqual(['x', 'y', 'z'])
    expect(ordenarDesejos(entrada, 'recentes').map((i) => i.titulo)).toEqual(['x', 'y', 'z'])
    expect(entrada).toEqual(copia)
  })
})

describe('lerOrdemDesejos', () => {
  it('aceita as quatro ordens e cai em prioridade no resto', () => {
    expect(lerOrdemDesejos('preco')).toBe('preco')
    expect(lerOrdemDesejos('recentes')).toBe('recentes')
    expect(lerOrdemDesejos('serie')).toBe('serie')
    expect(lerOrdemDesejos('prioridade')).toBe('prioridade')
    expect(lerOrdemDesejos('qualquer')).toBe('prioridade')
    expect(lerOrdemDesejos(undefined)).toBe('prioridade')
  })
})
