import { codigoDeBarrasEhIsbn } from '@/lib/isbn'

/**
 * Leitura de código de barras a partir de quadros de vídeo.
 *
 * Usa a API nativa `BarcodeDetector` quando o navegador tem (Chrome/Android) e, onde não tem (Safari/iOS),
 * a biblioteca `@zxing/library` carregada sob demanda — só quem precisa do fallback baixa os ~400 KB.
 */

type BarcodeDetectorNativo = { detect(fonte: CanvasImageSource): Promise<{ rawValue: string; format: string }[]> }
type BarcodeDetectorCtor = {
  new (opcoes?: { formats?: string[] }): BarcodeDetectorNativo
  getSupportedFormats?: () => Promise<string[]>
}

export type Leitor = {
  motor: 'nativo' | 'zxing'
  /** Lê um quadro e devolve o primeiro EAN-13 encontrado (ou null). Nunca lança por "não achou nada". */
  ler(video: HTMLVideoElement): Promise<string | null>
}

export type ResultadoDaLeitura = { tipo: 'isbn'; isbn13: string } | { tipo: 'outro'; codigo: string }

/** Só EAN-13 com 978/979 vira ISBN; qualquer outro código lido recebe a mensagem "não é um ISBN". */
export function classificarCodigo(codigo: string): ResultadoDaLeitura {
  return codigoDeBarrasEhIsbn(codigo) ? { tipo: 'isbn', isbn13: codigo } : { tipo: 'outro', codigo }
}

export async function criarLeitor(): Promise<Leitor> {
  const Nativo = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  if (Nativo) {
    try {
      const formatos = (await Nativo.getSupportedFormats?.()) ?? ['ean_13']
      if (formatos.includes('ean_13')) {
        const detector = new Nativo({ formats: ['ean_13'] })
        return {
          motor: 'nativo',
          async ler(video) {
            const achados = await detector.detect(video).catch(() => [])
            return achados.find((a) => a.format === 'ean_13')?.rawValue ?? null
          },
        }
      }
    } catch {
      // cai no fallback
    }
  }

  const { MultiFormatReader, BarcodeFormat, DecodeHintType, RGBLuminanceSource, BinaryBitmap, HybridBinarizer } = await import(
    '@zxing/library'
  )
  const leitor = new MultiFormatReader()
  const dicas = new Map<number, unknown>()
  dicas.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13])
  dicas.set(DecodeHintType.TRY_HARDER, true)
  leitor.setHints(dicas as Map<never, never>)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  return {
    motor: 'zxing',
    async ler(video) {
      if (!ctx || !video.videoWidth) return null
      // Quadro reduzido: decodificar 1080p inteiro trava celular e não melhora a leitura de EAN-13.
      const largura = Math.min(video.videoWidth, 800)
      const altura = Math.round((video.videoHeight * largura) / video.videoWidth)
      canvas.width = largura
      canvas.height = altura
      ctx.drawImage(video, 0, 0, largura, altura)
      const { data } = ctx.getImageData(0, 0, largura, altura)
      const luminancia = new Uint8ClampedArray(largura * altura)
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        luminancia[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
      }
      try {
        const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminancia, largura, altura)))
        return leitor.decodeWithState(bitmap).getText()
      } catch {
        return null // NotFoundException etc.: quadro sem código legível
      }
    },
  }
}
