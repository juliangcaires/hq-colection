import { describe, expect, it } from 'vitest'
import { criarLimitador } from '@/lib/limite-taxa'
import { ehRotaDeCompartilhamento, ehRotaPublica } from '@/lib/rotas'

describe('ehRotaPublica', () => {
  it('libera login, criar conta e o compartilhamento /c/…', () => {
    for (const r of ['/login', '/criar-conta', '/c', '/c/abc123', '/c/abc123/series', '/c/abc123/capa/x.jpg']) expect(ehRotaPublica(r)).toBe(true)
  })
  it('NÃO libera rotas do app que só começam com a mesma letra', () => {
    for (const r of ['/colecao', '/configuracoes', '/importar', '/', '/series', '/item/1', '/api/capa/x', '/cx', '/c-outro', '/loginx']) expect(ehRotaPublica(r)).toBe(false)
  })
  it('só /c é de compartilhamento (noindex)', () => {
    expect(ehRotaDeCompartilhamento('/c/abc')).toBe(true)
    expect(ehRotaDeCompartilhamento('/colecao')).toBe(false)
  })
})

describe('criarLimitador', () => {
  it('deixa passar até o teto e bloqueia o excedente, por chave', () => {
    const t = 1000
    const l = criarLimitador({ max: 3, janelaMs: 60_000, agora: () => t })
    expect([1, 2, 3].map(() => l.tentar('a').ok)).toEqual([true, true, true])
    const bloqueada = l.tentar('a')
    expect(bloqueada.ok).toBe(false)
    expect(bloqueada.reiniciaEmMs).toBe(60_000)
    expect(l.tentar('b').ok).toBe(true) // outra chave não é afetada
  })
  it('a janela desliza: volta a passar quando as marcas antigas saem', () => {
    let t = 0
    const l = criarLimitador({ max: 2, janelaMs: 1000, agora: () => t })
    l.tentar('a')
    t = 500
    l.tentar('a')
    expect(l.tentar('a').ok).toBe(false)
    t = 1001 // a primeira saiu, a segunda ainda não
    expect(l.tentar('a').ok).toBe(true)
    expect(l.tentar('a').ok).toBe(false)
    t = 5000
    expect(l.tentar('a').ok).toBe(true)
  })
  it('não cresce sem limite com muitas chaves', () => {
    let t = 0
    const l = criarLimitador({ max: 1, janelaMs: 10_000, agora: () => t, maxChaves: 50 })
    for (let i = 0; i < 500; i++) {
      t += 1
      l.tentar(`k${i}`)
    }
    // sem lançar e ainda funcional
    expect(l.tentar('nova').ok).toBe(true)
  })
})
