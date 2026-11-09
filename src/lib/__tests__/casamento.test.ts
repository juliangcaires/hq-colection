import { describe, expect, it } from 'vitest'
import { casarAutores, casarEditora, casarSerie, editoraCanonica, LIMIAR_SERIE_AUTOMATICA } from '@/lib/casamento'

const series = [
  { id: '1', nome: 'One Piece' },
  { id: '2', nome: 'Batman: Ano Um' },
  { id: '3', nome: 'Berserk' },
  { id: '4', nome: 'One Piece Color Walk' },
  { id: '5', nome: 'Naruto' },
]

describe('casarSerie', () => {
  it('nome igual (sem acento e caixa) casa com pontuação 1', () => {
    const [melhor] = casarSerie(['one  PIECE'], series)
    expect(melhor.serie.id).toBe('1')
    expect(melhor.pontuacao).toBe(1)
  })
  it('ignora "Vol." e acento na comparação', () => {
    expect(casarSerie(['Batman — Ano Um'], series)[0].serie.id).toBe('2')
  })
  it('nome parecido sugere, mas abaixo do limiar automático só aparece como opção', () => {
    const r = casarSerie(['One Piece Edição Especial'], series)
    expect(r[0].serie.id).toBe('1')
    expect(r[0].pontuacao).toBeLessThan(LIMIAR_SERIE_AUTOMATICA)
  })
  it('erro de digitação pequeno ainda casa', () => {
    expect(casarSerie(['Berzerk'], series)[0].serie.id).toBe('3')
  })
  it('nada parecido devolve vazio', () => {
    expect(casarSerie(['Sandman'], series)).toEqual([])
    expect(casarSerie([null, ''], series)).toEqual([])
    expect(casarSerie(['x'], [])).toEqual([])
  })
  it('usa o melhor entre vários candidatos e limita a 3', () => {
    const r = casarSerie(['Título longo qualquer', 'Naruto'], series)
    expect(r[0].serie.id).toBe('5')
    expect(casarSerie(['One Piece'], [...series, { id: '6', nome: 'One Piece Party' }, { id: '7', nome: 'One Piece Pirate' }, { id: '8', nome: 'One Piece Novel' }]).length).toBeLessThanOrEqual(3)
  })
})

describe('casarEditora', () => {
  const tags = [
    { id: 'a', nome: 'Panini' },
    { id: 'b', nome: 'Pipoca & Nanquim' },
    { id: 'c', nome: 'Editora Companhia' },
  ]
  it.each([
    ['Panini Brasil', 'a'],
    ['PANINI COMICS', 'a'],
    ['Pipoca e Nanquim', 'b'],
    ['Editora Pipoca & Nanquim', 'b'],
    ['Companhia', 'c'],
  ])('%s → tag %s', (texto, id) => {
    expect(casarEditora(texto, tags).tag?.id).toBe(id)
  })
  it('apelido conhecido sem tag sugere o nome canônico', () => {
    expect(casarEditora('JBC', tags)).toEqual({ tag: null, nomeParaCriar: 'JBC' })
    expect(casarEditora('Mythos Editora', tags)).toEqual({ tag: null, nomeParaCriar: 'Mythos' })
  })
  it('editora desconhecida sugere criar com o próprio texto', () => {
    expect(casarEditora('Editora Zero', tags)).toEqual({ tag: null, nomeParaCriar: 'Editora Zero' })
  })
  it('tag do usuário com apelido diferente da API ainda casa', () => {
    expect(casarEditora('Panini Brasil', [{ id: 'x', nome: 'Panini Comics' }]).tag?.id).toBe('x')
  })
  it('sem texto não sugere nada', () => {
    expect(casarEditora(null, tags)).toEqual({ tag: null, nomeParaCriar: null })
    expect(casarEditora('  ', tags)).toEqual({ tag: null, nomeParaCriar: null })
  })
  it('editoraCanonica', () => {
    expect(editoraCanonica('Panini Comics')).toBe('Panini')
    expect(editoraCanonica('Editora Devir')).toBe('Devir')
    expect(editoraCanonica('Desconhecida')).toBeNull()
  })
})

describe('casarAutores', () => {
  const tags = [{ id: 't1', nome: 'Mike Mignola' }]
  it('casa "Sobrenome, Nome" e remove repetidos', () => {
    const r = casarAutores(['Mignola, Mike', 'Mike Mignola', 'John Byrne'], tags)
    expect(r).toEqual([
      { nome: 'Mignola, Mike', tag: { id: 't1', nome: 'Mike Mignola' } },
      { nome: 'John Byrne', tag: null },
    ])
  })
  it('ignora nomes vazios', () => {
    expect(casarAutores(['', '  '], tags)).toEqual([])
  })
})
