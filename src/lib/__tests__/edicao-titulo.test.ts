import { describe, expect, it } from 'vitest'
import { extrairSerieENumero } from '@/lib/edicao-titulo'
import { chaveEdicao, normalizarParaChave, normalizarTexto } from '@/lib/texto'

describe('extrairSerieENumero', () => {
  it.each([
    ['One Piece - Vol. 45', 'One Piece', 45],
    ['One Piece, Vol. 45', 'One Piece', 45],
    ['Berserk Vol. 3: A Era de Ouro', 'Berserk', 3],
    ['Batman #12', 'Batman', 12],
    ['Batman nº 12', 'Batman', 12],
    ['Dragon Ball Tomo 5', 'Dragon Ball', 5],
    ['Naruto 12', 'Naruto', 12],
    ['Naruto Gold 7 (Edição Especial)', 'Naruto Gold', 7],
    ['Fullmetal Alchemist (Vol. 27)', 'Fullmetal Alchemist', 27],
  ])('%s → %s, %d', (titulo, serie, numero) => {
    expect(extrairSerieENumero(titulo)).toEqual({ serie, numero })
  })

  it('sem número claro devolve nulos', () => {
    expect(extrairSerieENumero('Batman: Ano Um')).toEqual({ serie: null, numero: null })
    expect(extrairSerieENumero('Spider-Man 2099')).toEqual({ serie: null, numero: null })
    expect(extrairSerieENumero('')).toEqual({ serie: null, numero: null })
  })

  it('título que é só o marcador não vira série', () => {
    expect(extrairSerieENumero('Vol. 3')).toEqual({ serie: null, numero: 3 })
    expect(extrairSerieENumero('42')).toEqual({ serie: null, numero: null })
  })
})

describe('normalização', () => {
  it('tira acento, caixa e pontuação', () => {
    expect(normalizarTexto('  Pipoca & Nanquim! ')).toBe('pipoca e nanquim')
    expect(normalizarTexto('Édição Açaí')).toBe('edicao acai')
  })
  it('chave ignora vol., #, edição', () => {
    expect(normalizarParaChave('Berserk — Edição de Luxo Vol. 3')).toBe('berserk luxo 3')
    expect(normalizarParaChave('Batman #1')).toBe('batman 1')
  })
  it('chave da edição junta série, número, tipo e editora', () => {
    expect(chaveEdicao({ serie: 'Batman', numero: 1, tipo: 'hq', editora: 'Editora Panini' })).toBe('batman|1|hq|panini')
    expect(chaveEdicao({ serie: 'Batman Vol. 1', numero: null, tipo: null, editora: null })).toBe('batman 1|||')
  })
})
