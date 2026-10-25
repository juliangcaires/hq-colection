import { describe, expect, it } from 'vitest'
import {
  linhaCsvSchema,
  normalizarCabecalho,
  normalizarEstado,
  normalizarNumeroVolume,
  normalizarTipo,
} from '@/lib/csv-importacao'

describe('normalizarTipo', () => {
  it('ignora caixa, acento e espaços', () => {
    expect(normalizarTipo('Mangá ')).toBe('manga')
    expect(normalizarTipo('HQ')).toBe('hq')
    expect(normalizarTipo('Quadrinhos')).toBe('hq')
  })
  it('vazio vale hq e desconhecido é recusado (não adivinha)', () => {
    expect(normalizarTipo('')).toBe('hq')
    expect(normalizarTipo(undefined)).toBe('hq')
    expect(normalizarTipo('foguete')).toBeNull()
  })
})

describe('normalizarEstado', () => {
  it('entende variações e mantém Desejo como desejo', () => {
    expect(normalizarEstado('Desejo')).toBe('desejo')
    expect(normalizarEstado('LIDO')).toBe('lido')
    expect(normalizarEstado('Tenho')).toBe('comprado')
  })
  it('vazio vale comprado e desconhecido é recusado', () => {
    expect(normalizarEstado('')).toBe('comprado')
    expect(normalizarEstado('talvez')).toBeNull()
  })
})

describe('normalizarNumeroVolume', () => {
  it('aceita vazio, vírgula e inteiro', () => {
    expect(normalizarNumeroVolume('')).toEqual({ ok: true, valor: null })
    expect(normalizarNumeroVolume('1,5')).toEqual({ ok: true, valor: 1.5 })
    expect(normalizarNumeroVolume('12')).toEqual({ ok: true, valor: 12 })
  })
  it('texto que não é número NÃO vira null (senão a reimportação duplica)', () => {
    expect(normalizarNumeroVolume('abc')).toEqual({ ok: false })
  })
})

describe('normalizarCabecalho', () => {
  it('remove BOM, acento, caixa e espaços', () => {
    expect(normalizarCabecalho('﻿Título')).toBe('titulo')
    expect(normalizarCabecalho(' Numero Volume ')).toBe('numero_volume')
  })
})

describe('linhaCsvSchema', () => {
  it('recusa texto longo demais', () => {
    expect(linhaCsvSchema.safeParse({ titulo: 'x'.repeat(201) }).success).toBe(false)
    expect(linhaCsvSchema.safeParse({ titulo: 'ok' }).success).toBe(true)
  })
})
