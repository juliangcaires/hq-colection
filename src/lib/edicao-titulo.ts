/**
 * Extrai nome da série e número do volume de um título de livro ("One Piece - Vol. 45" → "One Piece", 45).
 * Funções puras. Quando não há número claro, devolve só o título (pode ser um one-shot ou uma série
 * sem numeração no título); a decisão final é sempre do usuário.
 */

export type SerieENumero = { serie: string | null; numero: number | null }

const SEPARADORES_FINAIS = /[\s,:;\-–—/(]+$/
// "vol. 3", "volume 3", "tomo 3", "nº 3", "no 3", "#3", "livro 3"
const MARCADOR = /(?:^|[\s,:;\-–—(])(?:vol(?:ume)?\.?|tomo|n[º°o]\.?|livro|#)\s*(\d{1,4})\b/i
// "Naruto 12": número solto no fim, depois de uma palavra. 1–3 dígitos para não pegar ano ("Spider-Man 2099").
const NUMERO_SOLTO_NO_FIM = /^(.*[^\d\s].*?)\s+(\d{1,3})$/

function limparSerie(texto: string): string | null {
  const limpo = texto.replace(SEPARADORES_FINAIS, '').trim()
  return limpo.length >= 1 ? limpo : null
}

export function extrairSerieENumero(titulo: string): SerieENumero {
  const t = titulo.trim().replace(/\s+/g, ' ')
  if (!t) return { serie: null, numero: null }

  const marcador = MARCADOR.exec(t)
  if (marcador) {
    const serie = limparSerie(t.slice(0, marcador.index))
    return { serie, numero: Number(marcador[1]) }
  }

  // Remove subtítulo entre parênteses antes de olhar o número solto: "Naruto 12 (Edição Especial)".
  const semParenteses = t.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const solto = NUMERO_SOLTO_NO_FIM.exec(semParenteses)
  if (solto) {
    const serie = limparSerie(solto[1])
    if (serie) return { serie, numero: Number(solto[2]) }
  }

  return { serie: null, numero: null }
}
