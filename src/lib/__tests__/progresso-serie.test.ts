import { describe, expect, it } from 'vitest'
import { calcularProgressoDaSerie, dicaDoTotal, progressoDeContagens, textoDoProgresso } from '@/lib/progresso-serie'

const v = (numero_volume: number | null, estado: 'desejo' | 'comprado' | 'lido' = 'comprado', variante_de: string | null = null) => ({
  numero_volume,
  estado,
  variante_de,
})

describe('calcularProgressoDaSerie', () => {
  it('usa o total declarado como Y', () => {
    const p = calcularProgressoDaSerie([v(1, 'lido'), v(2), v(3, 'desejo')], 10)
    expect(p).toMatchObject({ tenho: 2, lidos: 1, total: 10, origem: 'declarado' })
    expect(p.fracaoTenho).toBeCloseTo(0.2)
    expect(textoDoProgresso(p)).toBe('tenho 2 de 10')
    expect(dicaDoTotal(p)).toBe('')
  })

  it('sem total, Y é o maior número conhecido (desejo também prova que a série vai até ali) e a tela diz isso', () => {
    const p = calcularProgressoDaSerie([v(1), v(2, 'lido'), v(5, 'desejo')])
    expect(p).toMatchObject({ tenho: 2, lidos: 1, total: 5, origem: 'conhecidos' })
    expect(textoDoProgresso(p)).toBe('tenho 2 de 5 conhecidos')
    expect(dicaDoTotal(p)).toMatch(/maior número/)
  })

  it('série sem número e sem total: só o X, sem Y nem barra', () => {
    const p = calcularProgressoDaSerie([v(null), v(null, 'lido'), v(null, 'desejo')])
    expect(p).toMatchObject({ tenho: 2, lidos: 1, total: null, origem: null, fracaoTenho: null, fracaoLidos: null })
    expect(textoDoProgresso(p)).toBe('tenho 2')
    expect(dicaDoTotal(p)).toMatch(/não dá para calcular/)
  })

  it('série sem número mas com total declarado: conta os itens contra o total', () => {
    const p = calcularProgressoDaSerie([v(null), v(null)], 4)
    expect(p).toMatchObject({ tenho: 2, total: 4, origem: 'declarado' })
  })

  it('número repetido conta uma vez só (lido se qualquer cópia for lida)', () => {
    const p = calcularProgressoDaSerie([v(1), v(1, 'lido'), v(2)], 5)
    expect(p).toMatchObject({ tenho: 2, lidos: 1 })
  })

  it('variante conta uma vez só: a outra capa não entra nem em tenho nem em lidos nem no maior número', () => {
    const p = calcularProgressoDaSerie([v(1, 'lido'), v(1, 'lido', 'id-do-principal'), v(2), v(9, 'comprado', 'id-do-principal')])
    expect(p).toMatchObject({ tenho: 2, lidos: 1, total: 2, origem: 'conhecidos' })
  })

  it('desejo não conta como "tenho"', () => {
    const p = calcularProgressoDaSerie([v(1, 'desejo'), v(2, 'desejo')], 3)
    expect(p).toMatchObject({ tenho: 0, lidos: 0, fracaoTenho: 0 })
  })

  it('número fracionário conta como volume, mas não define o maior número; o Y nunca fica abaixo do X', () => {
    const p = calcularProgressoDaSerie([v(1), v(1.5), v(2)])
    expect(p).toMatchObject({ tenho: 3, total: 3, origem: 'conhecidos' })
    expect(p.fracaoTenho).toBe(1)
  })

  it('aceita número vindo do banco como texto (numeric)', () => {
    const p = calcularProgressoDaSerie([{ numero_volume: '3.0' as unknown as number, estado: 'lido' }], 6)
    expect(p).toMatchObject({ tenho: 1, lidos: 1 })
  })

  it('série vazia ou total zero/negativo: sem Y declarado', () => {
    expect(calcularProgressoDaSerie([], 0)).toMatchObject({ tenho: 0, total: null })
    expect(calcularProgressoDaSerie([v(1)], -3)).toMatchObject({ total: 1, origem: 'conhecidos' })
  })

  it('tenho acima do total declarado: a barra trava em 100%', () => {
    const p = calcularProgressoDaSerie([v(1), v(2), v(3)], 2)
    expect(p.fracaoTenho).toBe(1)
    expect(p.total).toBe(2)
  })
})

describe('progressoDeContagens', () => {
  it('é o que a lista de séries usa (contagens vindas do banco)', () => {
    expect(progressoDeContagens({ tenho: 3, lidos: 1, totalDeclarado: null, maximoConhecido: 8 })).toMatchObject({ total: 8, origem: 'conhecidos' })
    expect(progressoDeContagens({ tenho: 3, lidos: 1, totalDeclarado: 12, maximoConhecido: 8 })).toMatchObject({ total: 12, origem: 'declarado' })
    expect(progressoDeContagens({ tenho: 0, lidos: 0, totalDeclarado: null, maximoConhecido: null })).toMatchObject({ total: null })
  })
})
