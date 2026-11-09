import { describe, expect, it } from 'vitest'
import { detectarTipoDeImagem, removerMetadados, sha256Hex } from '@/lib/imagem'

const bytes = (...n: number[]) => new Uint8Array(n)
const texto = (s: string) => Array.from(s, (c) => c.charCodeAt(0))
const cont = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, 'latin1'))

function jpegComExif(orientacao: number) {
  const exif = [
    ...texto('Exif'), 0, 0,
    0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8,
    0, 2,
    0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientacao, 0, 0, // Orientation
    0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 0x1a, // GPSInfo ponteiro
    0, 0, 0, 0,
    ...texto('GPS-SECRETO'),
  ]
  const app1 = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff, ...exif]
  const com = [0xff, 0xfe, 0, 2 + 5, ...texto('oi!!!')]
  const app0 = [0xff, 0xe0, 0, 16, ...texto('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  const dqt = [0xff, 0xdb, 0, 4, 0xaa, 0xbb]
  const sos = [0xff, 0xda, 0, 4, 0x11, 0x22, 0x01, 0x02, 0x03, 0xff, 0xd9]
  return bytes(0xff, 0xd8, ...app0, ...app1, ...com, ...dqt, ...sos)
}

describe('detectarTipoDeImagem', () => {
  it('reconhece JPEG, PNG e WebP pelos bytes', () => {
    expect(detectarTipoDeImagem(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(detectarTipoDeImagem(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
    expect(detectarTipoDeImagem(bytes(...texto('RIFF'), 1, 0, 0, 0, ...texto('WEBP')))).toBe('image/webp')
  })
  it('rejeita HTML, SVG e lixo mesmo com cabeçalho HTTP dizendo imagem', () => {
    expect(detectarTipoDeImagem(bytes(...texto('<html><script>')))).toBeNull()
    expect(detectarTipoDeImagem(bytes(...texto('<svg xmlns=')))).toBeNull()
    expect(detectarTipoDeImagem(bytes())).toBeNull()
    expect(detectarTipoDeImagem(bytes(0xff, 0xd8))).toBeNull()
  })
})

describe('sha256Hex', () => {
  it('bate com o valor conhecido', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('removerMetadados — JPEG', () => {
  it('tira GPS e comentário, mantém JFIF, tabelas e imagem', () => {
    const r = removerMetadados(jpegComExif(1))!
    expect(r.mime).toBe('image/jpeg')
    expect(cont(r.bytes, 'GPS-SECRETO')).toBe(false)
    expect(cont(r.bytes, 'oi!!!')).toBe(false)
    expect(cont(r.bytes, 'Exif')).toBe(false)
    expect(cont(r.bytes, 'JFIF')).toBe(true)
    expect(r.bytes.at(-1)).toBe(0xd9)
    expect(r.bytes.length).toBeLessThan(jpegComExif(1).length)
  })
  it('preserva só a orientação (foto de celular não pode ficar deitada)', () => {
    const r = removerMetadados(jpegComExif(6))!
    expect(cont(r.bytes, 'GPS-SECRETO')).toBe(false)
    expect(cont(r.bytes, 'Exif')).toBe(true) // APP1 mínimo, só com a tag de orientação
    const i = Buffer.from(r.bytes).indexOf(Buffer.from([0x01, 0x12, 0x00, 0x03]))
    expect(r.bytes[i + 9]).toBe(6)
    // reaplicar é idempotente
    expect(Array.from(removerMetadados(r.bytes)!.bytes)).toEqual(Array.from(r.bytes))
  })
  it('JPEG truncado é recusado', () => {
    expect(removerMetadados(bytes(0xff, 0xd8, 0xff, 0xe1, 0x10, 0x00, 0x01))).toBeNull()
  })
})

describe('removerMetadados — PNG', () => {
  const chunk = (tipo: string, dados: number[]) => [0, 0, 0, dados.length, ...texto(tipo), ...dados, 1, 2, 3, 4]
  it('tira tEXt/eXIf/tIME e mantém IHDR/IDAT/IEND', () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
      ...chunk('tEXt', texto('Comment\0segredo')),
      ...chunk('eXIf', texto('GPS')),
      ...chunk('tIME', [7, 234, 1, 1, 0, 0, 0]),
      ...chunk('IDAT', [1, 2, 3]),
      ...chunk('IEND', []))
    const r = removerMetadados(png)!
    for (const t of ['tEXt', 'eXIf', 'tIME', 'segredo']) expect(cont(r.bytes, t)).toBe(false)
    for (const t of ['IHDR', 'IDAT', 'IEND']) expect(cont(r.bytes, t)).toBe(true)
  })
})

describe('removerMetadados — WebP', () => {
  const chunk = (tipo: string, dados: number[]) => [...texto(tipo), dados.length, 0, 0, 0, ...dados, ...(dados.length % 2 ? [0] : [])]
  it('tira EXIF/XMP, ajusta o tamanho do RIFF e limpa as flags do VP8X', () => {
    const corpo = [...chunk('VP8X', [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...chunk('EXIF', texto('GPS-SECRETO')), ...chunk('XMP ', texto('xmp')), ...chunk('VP8 ', [1, 2, 3, 4])]
    const webp = bytes(...texto('RIFF'), (corpo.length + 4) & 0xff, (corpo.length + 4) >> 8, 0, 0, ...texto('WEBP'), ...corpo)
    const r = removerMetadados(webp)!
    expect(r.mime).toBe('image/webp')
    expect(cont(r.bytes, 'GPS-SECRETO')).toBe(false)
    expect(cont(r.bytes, 'XMP ')).toBe(false)
    expect(cont(r.bytes, 'VP8 ')).toBe(true)
    const riff = r.bytes[4] | (r.bytes[5] << 8) | (r.bytes[6] << 16)
    expect(riff).toBe(r.bytes.length - 8)
    const vp8x = Buffer.from(r.bytes).indexOf('VP8X')
    expect(r.bytes[vp8x + 8] & 0x0c).toBe(0)
  })
})

describe('removerMetadados — desconhecido', () => {
  it('não publica o que não é imagem', () => {
    expect(removerMetadados(bytes(...texto('<svg onload=alert(1)>')))).toBeNull()
  })
})
