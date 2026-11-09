import { describe, expect, it } from 'vitest'
import { apelidoSchema, caminhoDoLink, escopoSchema, SECOES_COMPARTILHAVEIS, tokenValido } from '@/lib/compartilhamento'

describe('escopoSchema', () => {
  it('aceita seções conhecidas, remove repetidas e exige ao menos uma', () => {
    expect(escopoSchema.parse(['colecao', 'colecao', 'ranking'])).toEqual(['colecao', 'ranking'])
    expect(() => escopoSchema.parse([])).toThrow()
    expect(() => escopoSchema.parse(['colecao', 'preco'])).toThrow()
    expect(() => escopoSchema.parse(['loja'])).toThrow()
  })
  it('nenhuma seção compartilhável expõe preço, loja ou data de compra', () => {
    const valores = SECOES_COMPARTILHAVEIS.map((s) => s.valor as string)
    for (const proibido of ['preco', 'loja', 'data_aquisicao']) expect(valores).not.toContain(proibido)
  })
})

describe('apelidoSchema', () => {
  it('normaliza para minúsculas e valida o formato', () => {
    expect(apelidoSchema.parse('  Julian_HQ ')).toBe('julian_hq')
    expect(() => apelidoSchema.parse('Convite')).toThrow()
    for (const ruim of ['ab', 'com espaço', 'acentuação', 'x'.repeat(31), 'a-b-c', '']) expect(() => apelidoSchema.parse(ruim)).toThrow()
  })
})

describe('token', () => {
  it('só o formato que o banco gera', () => {
    expect(tokenValido('a'.repeat(64))).toBe(true)
    expect(tokenValido('curto')).toBe(false)
    expect(tokenValido('../etc/passwd'.padEnd(40, 'a'))).toBe(false)
    expect(caminhoDoLink('abc')).toBe('/c/abc')
  })
})
