import { describe, expect, it } from 'vitest'
import { serieEstaLida } from '@/lib/volumes'

describe('serieEstaLida', () => {
  it('é lida quando todos os volumes possuídos estão lidos', () => {
    expect(serieEstaLida([{ estado: 'lido' }, { estado: 'lido' }])).toBe(true)
  })
  it('desejo não conta como possuído', () => {
    expect(serieEstaLida([{ estado: 'lido' }, { estado: 'desejo' }])).toBe(true)
  })
  it('volume novo comprado devolve a série para em andamento', () => {
    expect(serieEstaLida([{ estado: 'lido' }, { estado: 'comprado' }])).toBe(false)
  })
  it('série vazia ou só de desejos não é lida', () => {
    expect(serieEstaLida([])).toBe(false)
    expect(serieEstaLida([{ estado: 'desejo' }])).toBe(false)
  })
})
