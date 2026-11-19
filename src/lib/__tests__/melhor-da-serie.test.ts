import { describe, expect, it } from 'vitest'
import { podeMarcarMelhor } from '../melhor-da-serie'

const ok = { estado: 'lido', serieId: 's1', varianteDe: null, lidosNaSerie: 2 } as const

describe('podeMarcarMelhor', () => {
  it('lido, com série, principal e 2 ou mais lidos: pode (a nota não entra na regra)', () => {
    expect(podeMarcarMelhor(ok)).toBe(true)
    expect(podeMarcarMelhor({ ...ok, lidosNaSerie: 10 })).toBe(true)
  })
  it('com 1 lido na série, não', () => {
    expect(podeMarcarMelhor({ ...ok, lidosNaSerie: 1 })).toBe(false)
    expect(podeMarcarMelhor({ ...ok, lidosNaSerie: 0 })).toBe(false)
  })
  it('não lido, não', () => {
    expect(podeMarcarMelhor({ ...ok, estado: 'comprado' })).toBe(false)
    expect(podeMarcarMelhor({ ...ok, estado: 'desejo' })).toBe(false)
  })
  it('variante, não', () => {
    expect(podeMarcarMelhor({ ...ok, varianteDe: 'outro' })).toBe(false)
  })
  it('sem série, não', () => {
    expect(podeMarcarMelhor({ ...ok, serieId: null })).toBe(false)
  })
})
