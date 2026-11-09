/**
 * Normalização de texto para comparar nomes (séries, editoras, autores) e montar a chave de uma edição.
 * Funções puras.
 */

/** Minúsculas, sem acento, só letras/números separados por um espaço; "&" vira "e". */
export function normalizarTexto(entrada: string): string {
  return entrada
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Palavras que só marcam "volume/edição" e não diferenciam uma obra da outra. */
const RUIDO_DE_CHAVE = new Set(['vol', 'volume', 'tomo', 'edicao', 'ed', 'no', 'n', 'numero', 'a', 'o', 'de', 'do', 'da'])

/**
 * Como `normalizarTexto`, sem as palavras de ruído ("vol.", "#", "edição", "nº"...).
 * "Berserk — Edição de Luxo Vol. 3" e "berserk edicao luxo 3" caem no mesmo texto.
 */
export function normalizarParaChave(entrada: string): string {
  return normalizarTexto(entrada.replace(/#/g, ' '))
    .split(' ')
    .filter((p) => p && !RUIDO_DE_CHAVE.has(p))
    .join(' ')
}

export type PartesDaChave = {
  serie: string
  numero: number | null
  tipo: 'hq' | 'manga' | null
  editora: string | null
}

/** Chave que identifica uma edição sem depender do ISBN: série + número + tipo + editora, já normalizados. */
export function chaveEdicao({ serie, numero, tipo, editora }: PartesDaChave): string {
  const num = numero === null || !Number.isFinite(numero) ? '' : String(numero)
  const ed = editora ? normalizarParaChave(editora.replace(/\beditora\b/gi, ' ')) : ''
  return [normalizarParaChave(serie), num, tipo ?? '', ed].join('|').slice(0, 400)
}
