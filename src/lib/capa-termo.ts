/**
 * Normalização do termo de busca de capa.
 *
 * Provedores externos (Google Books, AniList, MangaDex, Open Library) indexam
 * a OBRA, não a edição — buscar "Berserk #3" ou "Berserk Vol. 3" retorna zero
 * resultados, buscar "Berserk" retorna a obra. Quando o item já tem série
 * vinculada, o nome da série é sempre o termo certo; sem série, removemos
 * marcadores de volume conhecidos do fim do título.
 *
 * Função pura — sem I/O — para ser fácil de testar isoladamente.
 */

export type TermoBusca = { termo: string; volume: number | null }

const MARCADORES_VOLUME = [
  /#\s*(\d+(?:[.,]\d+)?)$/,
  /\bn[º°]\.?\s*(\d+(?:[.,]\d+)?)$/i,
  /\bvol\.?\s+(\d+(?:[.,]\d+)?)$/i,
  /\bvolume\s+(\d+(?:[.,]\d+)?)$/i,
  /\btomo\s+(\d+(?:[.,]\d+)?)$/i,
  /\bv\.\s*(\d+(?:[.,]\d+)?)$/i,
  /-\s*(\d+(?:[.,]\d+)?)$/,
]

function extrairMarcadorVolume(titulo: string): { termo: string; volume: number } | null {
  for (const regex of MARCADORES_VOLUME) {
    const match = titulo.match(regex)
    if (!match) continue
    const termo = titulo.slice(0, match.index).trim()
    if (!termo) continue // marcador ocupava o título inteiro — não há o que usar como termo
    return { termo, volume: Number(match[1].replace(',', '.')) }
  }
  return null
}

export function normalizarTermoBusca(
  titulo: string,
  serieNome?: string | null,
  numeroVolume?: number | null
): TermoBusca {
  const nomeSerie = serieNome?.trim()
  if (nomeSerie) {
    return { termo: nomeSerie, volume: numeroVolume ?? null }
  }

  const tituloLimpo = titulo.trim()
  const extraido = extrairMarcadorVolume(tituloLimpo)
  if (extraido) {
    return { termo: extraido.termo, volume: numeroVolume ?? extraido.volume }
  }

  return { termo: tituloLimpo, volume: numeroVolume ?? null }
}
