import { afterEach, describe, expect, it, vi } from 'vitest'
import { classificarCodigo, criarLeitor } from '@/lib/leitor-codigo'

afterEach(() => {
  delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector
})

describe('classificarCodigo', () => {
  it('ISBN (978/979, dígito certo) é aceito', () => {
    expect(classificarCodigo('9788545702870')).toEqual({ tipo: 'isbn', isbn13: '9788545702870' })
    expect(classificarCodigo('9791032305843')).toEqual({ tipo: 'isbn', isbn13: '9791032305843' })
  })
  it('EAN de produto comum, EAN com dígito errado e ISSN são rejeitados como "outro"', () => {
    for (const c of ['7891234567895', '9788545702871', '977123456700', '12345']) {
      expect(classificarCodigo(c)).toEqual({ tipo: 'outro', codigo: c })
    }
  })
})

describe('criarLeitor com BarcodeDetector nativo', () => {
  it('usa o nativo e devolve só o EAN-13 detectado', async () => {
    const detect = vi.fn(async () => [
      { rawValue: 'https://exemplo.com', format: 'qr_code' },
      { rawValue: '9788545702870', format: 'ean_13' },
    ])
    class Falso {
      static getSupportedFormats = async () => ['ean_13', 'qr_code']
      detect = detect
    }
    ;(globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = Falso
    const leitor = await criarLeitor()
    expect(leitor.motor).toBe('nativo')
    expect(await leitor.ler({} as HTMLVideoElement)).toBe('9788545702870')
  })

  it('erro do detector vira "nada lido", sem lançar', async () => {
    class Falso {
      static getSupportedFormats = async () => ['ean_13']
      detect = async () => {
        throw new Error('quadro inválido')
      }
    }
    ;(globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = Falso
    const leitor = await criarLeitor()
    expect(await leitor.ler({} as HTMLVideoElement)).toBeNull()
  })
})
