import { chaveEdicao } from '@/lib/texto'
import { extrairSerieENumero } from '@/lib/edicao-titulo'
import { googleBooksUrl, melhorImagemGoogleBooks, type GoogleBooksImageLinks } from '@/lib/capa-busca'
import type { TipoObra } from '@/lib/types'

/**
 * Busca de uma edição por ISBN: catálogo interno → BrasilAPI → Google Books.
 * Tudo que vem de fora é gravado no catálogo (via `CatalogoEdicoes`) para o próximo usuário não gastar chamada.
 * A rede e o catálogo entram por parâmetro, então os testes rodam com respostas fixas, sem rede.
 */

export type OrigemEdicao = 'brasilapi' | 'google_books' | 'open_library' | 'usuario'

export type EdicaoDados = {
  isbn13: string | null
  titulo: string
  serie_nome: string | null
  numero_volume: number | null
  tipo: TipoObra | null
  editora: string | null
  autores: string[]
  ano: number | null
  paginas: number | null
  sinopse: string | null
  capa_url_externa: string | null
  origem: OrigemEdicao
}

export type FonteEdicao = 'catalogo' | 'brasilapi' | 'google_books'

export type ResultadoBuscaIsbn =
  | { status: 'ok'; edicao: EdicaoDados; fonte: FonteEdicao; edicaoId: string | null }
  | { status: 'nao_encontrado' }
  /** Nada encontrado e pelo menos uma fonte falhou (quota, timeout, erro): vale tentar de novo mais tarde. */
  | { status: 'indisponivel'; motivo: 'quota' | 'erro' | 'limite' }

/** Acesso ao catálogo interno (implementado com o Supabase na action; falso nos testes). */
export type CatalogoEdicoes = {
  buscar(isbn13: string): Promise<(EdicaoDados & { id: string }) | null>
  /** Grava uma edição vinda de fora; devolve o id (ou null se a gravação falhou — não derruba a busca). */
  registrar(edicao: EdicaoDados): Promise<string | null>
}

export type OpcoesBuscaIsbn = {
  catalogo: CatalogoEdicoes
  fetchFn?: typeof fetch
  timeoutMs?: number
  /** Chamado antes de ir a uma API externa; false = limite do usuário atingido. */
  permitirExterno?: () => Promise<boolean>
}

const TIMEOUT_PADRAO_MS = 8000

type RespostaProvedor =
  | { status: 'ok'; edicao: EdicaoDados }
  | { status: 'vazio' }
  | { status: 'quota' }
  | { status: 'erro' }

// ---------------------------------------------------------------------------------------------
// Sanitização do que vem de fora (limites iguais aos checks da tabela `edicoes`)
// ---------------------------------------------------------------------------------------------

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

const inteiro = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : typeof v === 'number' ? Math.trunc(v) : NaN
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

const listaDeTextos = (v: unknown, maxItens: number, maxTam: number): string[] =>
  Array.isArray(v)
    ? v.map((x) => texto(x, maxTam)).filter((x): x is string => x !== null).slice(0, maxItens)
    : []

const urlHttps = (v: unknown): string | null => {
  const t = texto(v, 1000)
  if (!t) return null
  const https = t.replace(/^http:\/\//i, 'https://')
  return /^https:\/\/[^\s]+$/.test(https) ? https : null
}

function semHtml(v: unknown, max: number): string | null {
  const t = texto(typeof v === 'string' ? v.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ') : v, max)
  return t
}

function inferirTipo(...fontes: unknown[]): TipoObra {
  const junto = fontes
    .flatMap((f) => (Array.isArray(f) ? f : [f]))
    .filter((x): x is string => typeof x === 'string')
    .join(' ')
    .toLowerCase()
  return /(?<![a-zà-ú])mang[aá]s?(?![a-zà-ú])/.test(junto) ? 'manga' : 'hq'
}

function montarEdicao(base: Omit<EdicaoDados, 'serie_nome' | 'numero_volume'>): EdicaoDados {
  const { serie, numero } = extrairSerieENumero(base.titulo)
  return { ...base, serie_nome: serie, numero_volume: numero }
}

// ---------------------------------------------------------------------------------------------
// Provedores
// ---------------------------------------------------------------------------------------------

function classificarHttp(status: number): RespostaProvedor | null {
  if (status === 404 || status === 400 || status === 422) return { status: 'vazio' }
  if (status === 429 || status === 403) return { status: 'quota' }
  if (status >= 500 || status < 200 || status >= 300) return { status: 'erro' }
  return null
}

export async function consultarBrasilApi(isbn13: string, fetchFn: typeof fetch, timeoutMs: number): Promise<RespostaProvedor> {
  try {
    const res = await fetchFn(`https://brasilapi.com.br/api/isbn/v1/${encodeURIComponent(isbn13)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const falha = classificarHttp(res.status)
    if (falha) return falha
    const d: unknown = await res.json()
    if (!d || typeof d !== 'object') return { status: 'vazio' }
    const o = d as Record<string, unknown>
    const titulo = texto(o.title, 300)
    if (!titulo) return { status: 'vazio' }
    const subtitulo = texto(o.subtitle, 200)
    return {
      status: 'ok',
      edicao: montarEdicao({
        isbn13,
        titulo,
        tipo: inferirTipo(o.subjects, o.publisher, o.title, subtitulo),
        editora: texto(o.publisher, 120),
        autores: listaDeTextos(o.authors, 20, 120),
        ano: inteiro(o.year, 1400, 2100),
        paginas: inteiro(o.page_count, 1, 20000),
        sinopse: semHtml(o.synopsis, 4000),
        capa_url_externa: urlHttps(o.cover_url),
        origem: 'brasilapi',
      }),
    }
  } catch {
    return { status: 'erro' }
  }
}

type GoogleVolume = {
  volumeInfo?: {
    title?: unknown
    subtitle?: unknown
    authors?: unknown
    publisher?: unknown
    publishedDate?: unknown
    description?: unknown
    pageCount?: unknown
    categories?: unknown
    imageLinks?: GoogleBooksImageLinks
  }
}

export async function consultarGoogleBooks(isbn13: string, fetchFn: typeof fetch, timeoutMs: number): Promise<RespostaProvedor> {
  try {
    const res = await fetchFn(googleBooksUrl(`isbn:${encodeURIComponent(isbn13)}`, 1), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const falha = classificarHttp(res.status)
    if (falha) return falha
    const d: unknown = await res.json()
    const item = (d as { items?: GoogleVolume[] } | null)?.items?.[0]
    const v = item?.volumeInfo
    const titulo = texto(v?.title, 300)
    if (!v || !titulo) return { status: 'vazio' }
    const ano = typeof v.publishedDate === 'string' ? inteiro(v.publishedDate.slice(0, 4), 1400, 2100) : null
    return {
      status: 'ok',
      edicao: montarEdicao({
        isbn13,
        titulo,
        tipo: inferirTipo(v.categories, v.publisher, v.title),
        editora: texto(v.publisher, 120),
        autores: listaDeTextos(v.authors, 20, 120),
        ano,
        paginas: inteiro(v.pageCount, 1, 20000),
        sinopse: semHtml(v.description, 4000),
        capa_url_externa: urlHttps(melhorImagemGoogleBooks(v.imageLinks)),
        origem: 'google_books',
      }),
    }
  } catch {
    return { status: 'erro' }
  }
}

/** Completa só o que falta em `base` com `extra` (a fonte principal nunca é sobrescrita). */
function completar(base: EdicaoDados, extra: EdicaoDados): EdicaoDados {
  return {
    ...base,
    editora: base.editora ?? extra.editora,
    autores: base.autores.length > 0 ? base.autores : extra.autores,
    ano: base.ano ?? extra.ano,
    paginas: base.paginas ?? extra.paginas,
    sinopse: base.sinopse ?? extra.sinopse,
    capa_url_externa: base.capa_url_externa ?? extra.capa_url_externa,
  }
}

export function chaveDaEdicao(e: EdicaoDados): string {
  return chaveEdicao({
    serie: e.serie_nome ?? e.titulo,
    numero: e.numero_volume,
    tipo: e.tipo,
    editora: e.editora,
  })
}

// ---------------------------------------------------------------------------------------------
// Cascata
// ---------------------------------------------------------------------------------------------

export async function buscarEdicaoPorIsbn(isbn13: string, opcoes: OpcoesBuscaIsbn): Promise<ResultadoBuscaIsbn> {
  const { catalogo, fetchFn = fetch, timeoutMs = TIMEOUT_PADRAO_MS } = opcoes

  // 1. Catálogo interno: não gasta chamada externa nem conta no limite do usuário.
  try {
    const noCatalogo = await catalogo.buscar(isbn13)
    if (noCatalogo) {
      const { id, ...edicao } = noCatalogo
      return { status: 'ok', edicao, fonte: 'catalogo', edicaoId: id }
    }
  } catch (e) {
    console.warn('[isbn] catálogo indisponível:', e instanceof Error ? e.message : 'erro')
  }

  if (opcoes.permitirExterno && !(await opcoes.permitirExterno())) {
    return { status: 'indisponivel', motivo: 'limite' }
  }

  const falhas = new Set<'quota' | 'erro'>()
  const anotar = (r: RespostaProvedor) => {
    if (r.status === 'quota' || r.status === 'erro') falhas.add(r.status)
  }

  // 2. BrasilAPI (agrega CBL, Mercado Editorial, Open Library e Google Books).
  const brasil = await consultarBrasilApi(isbn13, fetchFn, timeoutMs)
  anotar(brasil)
  let edicao: EdicaoDados | null = brasil.status === 'ok' ? brasil.edicao : null

  // 3. Google Books: principal se a BrasilAPI não achou; complemento (capa, sinopse) se achou mas faltou algo.
  if (!edicao || !edicao.capa_url_externa || !edicao.sinopse) {
    const google = await consultarGoogleBooks(isbn13, fetchFn, timeoutMs)
    anotar(google)
    if (google.status === 'ok') edicao = edicao ? completar(edicao, google.edicao) : google.edicao
  }

  if (!edicao) {
    if (falhas.size > 0) return { status: 'indisponivel', motivo: falhas.has('quota') ? 'quota' : 'erro' }
    return { status: 'nao_encontrado' }
  }

  const edicaoId = await catalogo.registrar(edicao).catch(() => null)
  return { status: 'ok', edicao, fonte: edicao.origem === 'brasilapi' ? 'brasilapi' : 'google_books', edicaoId }
}
