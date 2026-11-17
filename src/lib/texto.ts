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

/**
 * Sufixos de edição que não mudam a história ("Berserk Edição de Luxo", "Batman Deluxe"). Aplicados sobre o texto
 * já normalizado (sem acento, minúsculo, espaços simples) ANTES de tirar o ruído. Omnibus NÃO entra: a numeração
 * muda. Assumido o risco de juntar edições (decisão do Julian). A mesma lista existe em SQL
 * (`privado.normalizar_obra`, migration 0022): mudou aqui, mude lá.
 */
const SUFIXOS_DE_EDICAO = /(?:^| )(?:edicao de luxo|edicao luxo|deluxe edition|edicao deluxe|deluxe|nova edicao|edicao definitiva|definitive edition)(?= |$)/g

/** Remove os sufixos de edição; se sobrar nada (o nome era só o sufixo), mantém o texto original. */
export function removerSufixosDeEdicao(textoNormalizado: string): string {
  const sem = textoNormalizado.replace(SUFIXOS_DE_EDICAO, ' ').replace(/ +/g, ' ').trim()
  return sem || textoNormalizado
}

/** `normalizarParaChave` sem os sufixos de edição: base da identidade da OBRA e da SÉRIE (não da edição). */
function normalizarParaChaveDeObra(entrada: string): string {
  return normalizarParaChave(removerSufixosDeEdicao(normalizarTexto(entrada.replace(/#/g, ' '))))
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

export type PartesDaObra = {
  /** Nome da série, ou null para volume avulso. */
  serie: string | null
  numero: number | null
  titulo: string
  tipo: 'hq' | 'manga' | null
}

/**
 * Identidade da obra (volume) entre usuários: igual à `chaveEdicao` mas SEM a editora, então a mesma história em
 * edições diferentes casa (migration 0019). Volume numerado: `série|número|tipo`; sem número, o título entra no
 * lugar; avulso (sem série): `título||tipo`.
 */
export function chaveObra({ serie, numero, titulo, tipo }: PartesDaObra): string {
  const t = tipo ?? ''
  const nomeSerie = serie ? normalizarParaChaveDeObra(serie) : ''
  if (nomeSerie) {
    if (numero !== null && Number.isFinite(numero)) return [nomeSerie, String(numero), t].join('|').slice(0, 400)
    return [nomeSerie, `t:${normalizarParaChaveDeObra(titulo)}`, t].join('|').slice(0, 400)
  }
  return [normalizarParaChaveDeObra(titulo), '', t].join('|').slice(0, 400)
}

/** Identidade da série entre usuários (`série|tipo`, a mesma de `capas_catalogo.serie_chave`). */
export function chaveSerie(nome: string, tipo: 'hq' | 'manga' | null): string {
  return [normalizarParaChaveDeObra(nome), tipo ?? ''].join('|').slice(0, 400)
}
