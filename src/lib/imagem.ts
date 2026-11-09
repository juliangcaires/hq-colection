/**
 * Utilidades de imagem sem dependências: tipo pelos bytes, SHA-256 e remoção de metadados.
 * Capas que vão para o bucket público não podem levar GPS, modelo do aparelho nem comentários.
 */

export type MimeDeImagem = 'image/jpeg' | 'image/png' | 'image/webp'

export const EXT_POR_MIME_IMAGEM: Record<MimeDeImagem, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Tipo real da imagem pelos primeiros bytes (o cabeçalho HTTP e o nome do arquivo não são confiáveis). */
export function detectarTipoDeImagem(b: Uint8Array): MimeDeImagem | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp'
  return null
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copia = new Uint8Array(bytes) // evita ArrayBufferLike compartilhado e satisfaz o tipo de BufferSource
  const digest = await crypto.subtle.digest('SHA-256', copia)
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('')
}

function ascii(b: Uint8Array, inicio: number, tam: number): string {
  let s = ''
  for (let i = inicio; i < inicio + tam && i < b.length; i++) s += String.fromCharCode(b[i])
  return s
}

const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

function juntar(partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((n, p) => n + p.length, 0)
  const saida = new Uint8Array(total)
  let o = 0
  for (const p of partes) {
    saida.set(p, o)
    o += p.length
  }
  return saida
}

// ---------------------------------------------------------------------------------------------
// JPEG: tira Exif/XMP (APP1), ICC (APP2), IPTC (APP13) e comentários. Mantém só a orientação, que a
// foto de celular precisa para não aparecer deitada.
// ---------------------------------------------------------------------------------------------

/** Lê a tag Orientation (0x0112) do Exif de um JPEG; 1 (normal) quando não há. */
function orientacaoExif(app1: Uint8Array): number {
  // app1 = "Exif\0\0" + TIFF
  if (ascii(app1, 0, 4) !== 'Exif' || app1.length < 14) return 1
  const tiff = app1.subarray(6)
  const little = tiff[0] === 0x49 && tiff[1] === 0x49
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return 1
  const u16 = (o: number) => (little ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1])
  const u32 = (o: number) =>
    little ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16) | (tiff[o + 3] << 24)) >>> 0 : u32be(tiff, o)
  if (tiff.length < 8) return 1
  const ifd = u32(4)
  if (ifd + 2 > tiff.length) return 1
  const n = u16(ifd)
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12
    if (e + 12 > tiff.length) break
    if (u16(e) === 0x0112) {
      const v = u16(e + 8)
      return v >= 1 && v <= 8 ? v : 1
    }
  }
  return 1
}

/** APP1 mínimo: só a orientação. */
function exifSoOrientacao(orientacao: number): Uint8Array {
  const corpo = new Uint8Array([
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF big-endian, IFD0 em 8
    0x00, 0x01, // 1 entrada
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientacao, 0x00, 0x00, // Orientation, SHORT, 1
    0x00, 0x00, 0x00, 0x00, // sem próximo IFD
  ])
  const tamanho = corpo.length + 2
  return juntar([new Uint8Array([0xff, 0xe1, tamanho >> 8, tamanho & 0xff]), corpo])
}

function limparJpeg(b: Uint8Array): Uint8Array {
  const saida: Uint8Array[] = [b.subarray(0, 2)]
  let orientacao = 1
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break
    const marcador = b[i + 1]
    if (marcador === 0xff) {
      i++
      continue
    }
    // Marcadores sem tamanho (RSTn, TEM) e fim da imagem.
    if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
      saida.push(b.subarray(i, i + 2))
      i += 2
      continue
    }
    if (marcador === 0xd9) break
    const tam = (b[i + 2] << 8) | b[i + 3]
    const fim = i + 2 + tam
    if (tam < 2 || fim > b.length) return b.subarray(0, 0) // JPEG corrompido: quem chamou descarta
    if (marcador === 0xda) {
      // Início do scan: o resto (dados da imagem + EOI) vai inteiro.
      saida.push(b.subarray(i))
      i = b.length
      break
    }
    if (marcador === 0xe1 && ascii(b, i + 4, 4) === 'Exif') {
      orientacao = orientacaoExif(b.subarray(i + 4, fim))
    }
    const descartar = marcador === 0xe1 || marcador === 0xe2 || marcador === 0xed || marcador === 0xfe
    if (!descartar) saida.push(b.subarray(i, fim))
    i = fim
  }
  if (i < b.length && saida.length === 1) return b.subarray(0, 0)
  if (orientacao !== 1) saida.splice(1, 0, exifSoOrientacao(orientacao))
  return juntar(saida)
}

// ---------------------------------------------------------------------------------------------
// PNG: tira chunks de texto, tempo e Exif.
// ---------------------------------------------------------------------------------------------
const CHUNKS_PNG_DESCARTADOS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'])

function limparPng(b: Uint8Array): Uint8Array {
  const saida: Uint8Array[] = [b.subarray(0, 8)]
  let i = 8
  while (i + 12 <= b.length) {
    const tam = u32be(b, i)
    const fim = i + 12 + tam
    if (fim > b.length) return b.subarray(0, 0)
    const tipo = ascii(b, i + 4, 4)
    if (!CHUNKS_PNG_DESCARTADOS.has(tipo)) saida.push(b.subarray(i, fim))
    i = fim
    if (tipo === 'IEND') break
  }
  return juntar(saida)
}

// ---------------------------------------------------------------------------------------------
// WebP (RIFF): tira os chunks EXIF e XMP e limpa as flags correspondentes do VP8X.
// ---------------------------------------------------------------------------------------------
function limparWebp(b: Uint8Array): Uint8Array {
  const partes: Uint8Array[] = []
  let i = 12
  while (i + 8 <= b.length) {
    const tipo = ascii(b, i, 4)
    const tam = u32le(b, i + 4)
    const fim = i + 8 + tam + (tam % 2)
    if (fim > b.length + 1) return b.subarray(0, 0)
    const chunk = b.slice(i, Math.min(fim, b.length))
    if (tipo === 'EXIF' || tipo === 'XMP ') {
      i = fim
      continue
    }
    if (tipo === 'VP8X' && chunk.length >= 9) chunk[8] &= ~(0x08 | 0x04) // bits EXIF e XMP
    partes.push(chunk)
    i = fim
  }
  const corpo = juntar(partes)
  const cabecalho = new Uint8Array(12)
  cabecalho.set(b.subarray(0, 12))
  const tamanhoRiff = corpo.length + 4
  cabecalho[4] = tamanhoRiff & 0xff
  cabecalho[5] = (tamanhoRiff >> 8) & 0xff
  cabecalho[6] = (tamanhoRiff >> 16) & 0xff
  cabecalho[7] = (tamanhoRiff >>> 24) & 0xff
  return juntar([cabecalho, corpo])
}

/**
 * Remove metadados (GPS, aparelho, data, comentários) sem recodificar a imagem. Devolve os mesmos bytes
 * de pixels. Arquivo corrompido ou de tipo desconhecido → `null` (quem chamou não publica).
 */
export function removerMetadados(bytes: Uint8Array): { bytes: Uint8Array; mime: MimeDeImagem } | null {
  const mime = detectarTipoDeImagem(bytes)
  if (!mime) return null
  const limpo = mime === 'image/jpeg' ? limparJpeg(bytes) : mime === 'image/png' ? limparPng(bytes) : limparWebp(bytes)
  return limpo.length === 0 ? null : { bytes: limpo, mime }
}
