import { describe, expect, it } from 'vitest'
import { numeroInvalido, parseNumeroPtBr } from '@/lib/numeros'

describe('parseNumeroPtBr', () => {
  it.each([
    ['1,5', 1.5],
    ['1.5', 1.5],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['1.234.567', 1234567],
    ['-2', -2],
    ['  12 ', 12],
  ])('lê %j como %d', (entrada, esperado) => {
    expect(parseNumeroPtBr(entrada)).toBe(esperado)
  })

  it.each(['abc', '1e3', '1,2,3', '--1', '1,', ',5'])('recusa %j', (entrada) => {
    expect(parseNumeroPtBr(entrada)).toBeNull()
  })

  it('distingue vazio de inválido', () => {
    expect(numeroInvalido('')).toBe(false)
    expect(numeroInvalido('   ')).toBe(false)
    expect(numeroInvalido('abc')).toBe(true)
    expect(numeroInvalido('1,5')).toBe(false)
  })
})
