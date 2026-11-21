import { describe, expect, it } from 'vitest'
import {
  avaliacaoVazia,
  ehUltimoPasso,
  indicadorDePasso,
  mensagemDeConclusao,
  montarItensDoLote,
  motivoDeFicarDeFora,
  passoAnterior,
  podeEntrarNoLote,
  proximoPasso,
  rotuloDoVolume,
  temAvaliacaoDigitada,
} from '@/lib/leitura-lote'

describe('quem entra no lote (a regra do "Marcar como lido" em lote)', () => {
  it('só volume comprado entra; desejo e lido ficam de fora e dizem por quê', () => {
    expect(podeEntrarNoLote('comprado')).toBe(true)
    expect(podeEntrarNoLote('lido')).toBe(false)
    expect(podeEntrarNoLote('desejo')).toBe(false)
    expect(motivoDeFicarDeFora('comprado')).toBeNull()
    expect(motivoDeFicarDeFora('lido')).toMatch(/já está como lido/i)
    expect(motivoDeFicarDeFora('desejo')).toMatch(/desejo/i)
  })
})

describe('passo a passo', () => {
  it('"2 de 5", último passo e navegação sem passar das pontas', () => {
    expect(indicadorDePasso(1, 5)).toBe('2 de 5')
    expect(ehUltimoPasso(3, 5)).toBe(false)
    expect(ehUltimoPasso(4, 5)).toBe(true)
    expect(ehUltimoPasso(0, 1)).toBe(true)
    expect(proximoPasso(4, 5)).toBe(4)
    expect(proximoPasso(1, 5)).toBe(2)
    expect(passoAnterior(0)).toBe(0)
    expect(passoAnterior(3)).toBe(2)
  })

  it('rótulo do volume: "Série #n", sem repetir o número que o título já traz', () => {
    expect(rotuloDoVolume({ titulo: 'A Espada Negra', serieNome: 'Berserk', numeroVolume: 3 })).toBe('Berserk #3')
    expect(rotuloDoVolume({ titulo: 'Berserk #3', serieNome: 'Berserk', numeroVolume: 3 })).toBe('Berserk #3')
    expect(rotuloDoVolume({ titulo: 'Maus', serieNome: null, numeroVolume: null })).toBe('Maus')
  })
})

describe('fechar no meio', () => {
  it('só pede confirmação quando há nota ou crítica digitada (em branco não conta)', () => {
    expect(temAvaliacaoDigitada({})).toBe(false)
    expect(temAvaliacaoDigitada({ a: avaliacaoVazia(), b: { nota: null, critica: '   ', spoiler: true } })).toBe(false)
    expect(temAvaliacaoDigitada({ a: { nota: 3.5, critica: '', spoiler: false } })).toBe(true)
    expect(temAvaliacaoDigitada({ a: avaliacaoVazia(), b: { nota: null, critica: 'ótimo', spoiler: false } })).toBe(true)
  })
  it('conta só os volumes que ainda estão no lote', () => {
    expect(temAvaliacaoDigitada({ a: { nota: 4, critica: '', spoiler: false } }, ['b'])).toBe(false)
    expect(temAvaliacaoDigitada({ a: { nota: 4, critica: '', spoiler: false } }, ['a', 'b'])).toBe(true)
  })
})

describe('o que vai para o banco', () => {
  it('mantém a ordem; volume sem nota nem crítica (ou pulado) vai só com o id', () => {
    const itens = montarItensDoLote(['a', 'b', 'c'], {
      a: { nota: 4.5, critica: '  Muito bom  ', spoiler: true },
      b: avaliacaoVazia(),
    })
    expect(itens).toEqual([
      { item_id: 'a', nota: 4.5, critica: 'Muito bom', critica_spoiler: true },
      { item_id: 'b' },
      { item_id: 'c' },
    ])
  })
  it('spoiler sem crítica não vai; nota sozinha vai sem crítica', () => {
    expect(montarItensDoLote(['a', 'b'], { a: { nota: null, critica: ' ', spoiler: true }, b: { nota: 2, critica: '', spoiler: true } })).toEqual([
      { item_id: 'a' },
      { item_id: 'b', nota: 2 },
    ])
  })
  it('nota 0 não existe (a régua começa em 0,5): só `null` significa sem nota', () => {
    expect(montarItensDoLote(['a'], { a: { nota: 0.5, critica: '', spoiler: false } })).toEqual([{ item_id: 'a', nota: 0.5 }])
  })
})

describe('mensagem final', () => {
  it('singular e plural', () => {
    expect(mensagemDeConclusao(1)).toBe('1 volume marcado como lido')
    expect(mensagemDeConclusao(5)).toBe('5 volumes marcados como lidos')
  })
})
