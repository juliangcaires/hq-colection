import { describe, expect, it } from 'vitest'
import { serieEstaCompleta, serieEstaLida } from '@/lib/volumes'

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

describe('variante (outra capa do mesmo volume)', () => {
  const v = (numero_volume: number, estado: 'desejo' | 'comprado' | 'lido', variante_de: string | null = null) => ({ numero_volume, estado, variante_de })

  it('não conta como volume a mais para "completa"', () => {
    const volumes = [v(1, 'comprado'), v(1, 'comprado', 'principal-1')]
    expect(serieEstaCompleta({ totalVolumes: 2, temNumeracao: false, volumes })).toBe(false)
    expect(serieEstaCompleta({ totalVolumes: 1, temNumeracao: true, volumes })).toBe(true)
  })

  it('não muda "série lida": só os volumes normais decidem', () => {
    expect(serieEstaLida([v(1, 'lido'), v(1, 'comprado', 'principal-1')])).toBe(true)
    expect(serieEstaLida([v(1, 'comprado'), v(1, 'comprado', 'principal-1')])).toBe(false)
  })
})
