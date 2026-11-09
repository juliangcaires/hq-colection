import { APELIDOS_DE_EDITORA } from '@/lib/editoras'
import { normalizarParaChave, normalizarTexto } from '@/lib/texto'

/**
 * Casamento do que a API trouxe com os dados do usuário: série parecida, tag de editora (via apelidos)
 * e tags de autor. Funções puras. Só SUGEREM — nada é criado sem confirmação na tela.
 */

export type SerieLite = { id: string; nome: string }
export type TagBasica = { id: string; nome: string }

export type SerieSugerida = { serie: SerieLite; pontuacao: number }

/** Acima disto a série vem pré-selecionada; abaixo, só aparece como opção. */
export const LIMIAR_SERIE_AUTOMATICA = 0.85
const LIMIAR_SERIE_OPCAO = 0.6

function bigramas(t: string): string[] {
  const s = t.replace(/ /g, '')
  if (s.length < 2) return s ? [s] : []
  const r: string[] = []
  for (let i = 0; i < s.length - 1; i++) r.push(s.slice(i, i + 2))
  return r
}

/** Coeficiente de Dice sobre bigramas: 1 = igual, 0 = nada em comum. */
function dice(a: string, b: string): number {
  const A = bigramas(a)
  const B = bigramas(b)
  if (A.length === 0 || B.length === 0) return 0
  const contagem = new Map<string, number>()
  for (const x of A) contagem.set(x, (contagem.get(x) ?? 0) + 1)
  let comuns = 0
  for (const x of B) {
    const n = contagem.get(x) ?? 0
    if (n > 0) {
      comuns++
      contagem.set(x, n - 1)
    }
  }
  return (2 * comuns) / (A.length + B.length)
}

function pontuarSerie(candidato: string, serie: string): number {
  const a = normalizarParaChave(candidato)
  const b = normalizarParaChave(serie)
  if (!a || !b) return 0
  if (a === b) return 1
  const ta = a.split(' ')
  const tb = b.split(' ')
  const [curto, longo] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  // Todas as palavras do nome menor estão no maior ("one piece" ⊂ "one piece edicao especial"): parecida, não igual.
  const contido = curto.length >= 2 && curto.every((p) => longo.includes(p)) ? 0.8 : 0
  return Math.max(dice(a, b), contido)
}

/**
 * Séries do usuário mais parecidas com algum dos nomes candidatos (nome extraído do título, título inteiro...).
 * Devolve até 3, da mais para a menos parecida.
 */
export function casarSerie(candidatos: (string | null | undefined)[], series: SerieLite[]): SerieSugerida[] {
  const nomes = candidatos.filter((c): c is string => Boolean(c && c.trim()))
  if (nomes.length === 0) return []
  return series
    .map((serie) => ({ serie, pontuacao: Math.max(...nomes.map((n) => pontuarSerie(n, serie.nome))) }))
    .filter((s) => s.pontuacao >= LIMIAR_SERIE_OPCAO)
    .sort((x, y) => y.pontuacao - x.pontuacao || x.serie.nome.localeCompare(y.serie.nome, 'pt-BR'))
    .slice(0, 3)
    .map((s) => ({ serie: s.serie, pontuacao: Math.round(s.pontuacao * 100) / 100 }))
}

// ---------------------------------------------------------------------------------------------
// Editora
// ---------------------------------------------------------------------------------------------

const MAPA_APELIDOS = new Map(APELIDOS_DE_EDITORA.map(([apelido, editora]) => [apelido, editora]))

function semPalavraEditora(texto: string): string {
  return normalizarTexto(texto).replace(/\beditora\b/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Nome canônico da editora ("Panini Comics" → "Panini") ou null se não há apelido conhecido. */
export function editoraCanonica(texto: string): string | null {
  return MAPA_APELIDOS.get(normalizarTexto(texto)) ?? MAPA_APELIDOS.get(semPalavraEditora(texto)) ?? null
}

export type EditoraSugerida = {
  /** Tag de editora do usuário que combina; null quando não há. */
  tag: TagBasica | null
  /** Nome para criar a tag, se o usuário aceitar (canônico quando conhecido). */
  nomeParaCriar: string | null
}

function chaveDeEditora(texto: string): string {
  const canonica = editoraCanonica(texto)
  return semPalavraEditora(canonica ?? texto)
}

export function casarEditora(texto: string | null | undefined, tagsEditora: TagBasica[]): EditoraSugerida {
  const original = texto?.trim()
  if (!original) return { tag: null, nomeParaCriar: null }
  const alvo = chaveDeEditora(original)
  const tag = tagsEditora.find((t) => chaveDeEditora(t.nome) === alvo) ?? null
  return { tag, nomeParaCriar: tag ? null : (editoraCanonica(original) ?? original).slice(0, 80) }
}

// ---------------------------------------------------------------------------------------------
// Autores
// ---------------------------------------------------------------------------------------------

export type AutorSugerido = { nome: string; tag: TagBasica | null }

/** "Mignola, Mike" e "Mike Mignola" são a mesma pessoa. */
function chaveDeAutor(nome: string): string {
  const partes = nome.split(',')
  const ordenado = partes.length === 2 ? `${partes[1]} ${partes[0]}` : nome
  return normalizarTexto(ordenado)
}

export function casarAutores(autores: string[], tagsAutor: TagBasica[]): AutorSugerido[] {
  const vistos = new Set<string>()
  const resultado: AutorSugerido[] = []
  for (const bruto of autores) {
    const nome = bruto.trim().slice(0, 80)
    const chave = chaveDeAutor(nome)
    if (!chave || vistos.has(chave)) continue
    vistos.add(chave)
    resultado.push({ nome, tag: tagsAutor.find((t) => chaveDeAutor(t.nome) === chave) ?? null })
  }
  return resultado
}
