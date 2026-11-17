import { describe, expect, it } from 'vitest'
import { hrefDoItem, origemValida, rotuloDaOrigem, vizinhosDeVolume } from '../navegacao-item'

describe('origemValida', () => {
  it('aceita páginas internas conhecidas', () => {
    expect(origemValida('/colecao')).toBe('/colecao')
    expect(origemValida('/serie/abc')).toBe('/serie/abc')
    expect(origemValida('/')).toBe('/')
    expect(origemValida('/desejos?estado=desejo')).toBe('/desejos?estado=desejo')
  })
  it('rejeita externo e malformado', () => {
    for (const v of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', 'colecao', '', '/x/y', '/colecao\n', undefined, ['/colecao']]) {
      expect(origemValida(v as never)).toBeNull()
    }
  })
})

describe('rotuloDaOrigem', () => {
  it('rotula por página', () => {
    expect(rotuloDaOrigem('/serie/abc')).toBe('Série')
    expect(rotuloDaOrigem('/')).toBe('Início')
    expect(rotuloDaOrigem('/desejos?x=1')).toBe('Desejos')
  })
})

describe('hrefDoItem', () => {
  it('codifica a origem', () => {
    expect(hrefDoItem('1')).toBe('/item/1')
    expect(hrefDoItem('1', '/serie/a')).toBe('/item/1?de=%2Fserie%2Fa')
  })
})

describe('vizinhosDeVolume', () => {
  const v = (id: string, n: number | null) => ({ id, numero_volume: n })
  it('pula furos', () => {
    const r = vizinhosDeVolume([v('a', 1), v('b', 2), v('d', 5), v('e', 9)], 'b', 2)
    expect(r.anterior?.id).toBe('a')
    expect(r.proximo?.id).toBe('d')
  })
  it('extremos e sem número', () => {
    expect(vizinhosDeVolume([v('a', 1)], 'a', 1)).toEqual({ anterior: null, proximo: null })
    expect(vizinhosDeVolume([v('a', 1)], 'x', null)).toEqual({ anterior: null, proximo: null })
  })
})
