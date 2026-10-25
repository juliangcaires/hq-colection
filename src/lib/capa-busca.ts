import type { SupabaseClient } from '@supabase/supabase-js'
import type { TipoObra } from '@/lib/types'
import type { TermoBusca } from '@/lib/capa-termo'
import { novoCaminhoDeCapa } from '@/lib/supabase/capas'

export type Provedor = 'google_books' | 'open_library' | 'anilist' | 'mangadex'

export type CandidatoCapa = {
  url: string
  label: string
  provedor: Provedor
  /** id externo da obra no provedor (manga id do MangaDex, id do AniList) — permite pular a resolução por título numa próxima busca. */
  ref?: string | null
}

export type ResultadoProvedor =
  | { provedor: Provedor; status: 'ok'; candidatos: CandidatoCapa[] }
  | { provedor: Provedor; status: 'vazio' }
  | { provedor: Provedor; status: 'quota'; detalhe?: string }
  | { provedor: Provedor; status: 'erro'; detalhe: string }

/** O que já deu certo numa busca anterior para a série — evita repetir resolução por título. */
export type MemoriaSerie = {
  termo: string | null
  provedor: Provedor | null
  ref: string | null
}

const TETO_CANDIDATOS = 12
const MANGADEX_HEADERS = { 'User-Agent': 'hq-colection/0.1 (github.com/hq-colection)' }

type GoogleBooksImageLinks = {
  thumbnail?: string
  smallThumbnail?: string
  small?: string
  medium?: string
  large?: string
}

type GoogleBooksItem = {
  volumeInfo?: {
    title?: string
    imageLinks?: GoogleBooksImageLinks
  }
}

function melhorImagemGoogleBooks(links?: GoogleBooksImageLinks): string | null {
  const url = links?.large || links?.medium || links?.small || links?.thumbnail || links?.smallThumbnail
  return url ? url.replace('http://', 'https://') : null
}

/** Monta a URL do Google Books, injetando a chave própria quando configurada (GOOGLE_BOOKS_API_KEY) — sem ela, cai na quota anônima compartilhada, que satura fácil. */
function googleBooksUrl(q: string, maxResults: number): string {
  const key = process.env.GOOGLE_BOOKS_API_KEY
  let url = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=${maxResults}&country=BR`
  if (key) url += `&key=${encodeURIComponent(key)}`
  return url
}

export type ResultadoIsbn = { url: string; provedor: 'google_books' | 'open_library' }

/** Cascata ISBN: Google Books, depois Open Library Covers. Retorna a 1a imagem encontrada (melhor taxa de acerto — não é ambíguo). */
export async function buscarCapaPorIsbn(isbn: string): Promise<ResultadoIsbn | null> {
  try {
    const res = await fetch(googleBooksUrl(`isbn:${encodeURIComponent(isbn)}`, 1))
    if (res.status === 429 || res.status === 403) {
      console.warn(`[capa-busca] google_books (isbn): quota estourada — HTTP ${res.status}`)
    } else if (res.ok) {
      const data = await res.json()
      const item: GoogleBooksItem | undefined = data.items?.[0]
      const url = melhorImagemGoogleBooks(item?.volumeInfo?.imageLinks)
      if (url) return { url, provedor: 'google_books' }
    }
  } catch (e) {
    console.warn(`[capa-busca] google_books (isbn): erro — ${e instanceof Error ? e.message : 'desconhecido'}`)
  }

  const olUrl = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg`
  try {
    const res = await fetch(olUrl)
    if (res.ok) {
      const buf = await res.arrayBuffer()
      // Open Library devolve um placeholder minúsculo quando não tem capa
      if (buf.byteLength > 1000) return { url: olUrl, provedor: 'open_library' }
    }
  } catch {
    // sem sorte
  }

  return null
}

async function googleBooksPorTitulo(termo: string): Promise<ResultadoProvedor> {
  try {
    const res = await fetch(googleBooksUrl(`intitle:${encodeURIComponent(termo)}`, 8))
    if (res.status === 429 || res.status === 403) {
      return { provedor: 'google_books', status: 'quota', detalhe: `HTTP ${res.status}` }
    }
    if (!res.ok) return { provedor: 'google_books', status: 'erro', detalhe: `HTTP ${res.status}` }
    const data = await res.json()
    const items: GoogleBooksItem[] = data.items ?? []
    const candidatos: CandidatoCapa[] = items
      .map((it): CandidatoCapa | null => {
        const url = melhorImagemGoogleBooks(it.volumeInfo?.imageLinks)
        if (!url) return null
        return { url, label: it.volumeInfo?.title ?? termo, provedor: 'google_books' }
      })
      .filter((c): c is CandidatoCapa => c !== null)
      .slice(0, 8)
    return candidatos.length > 0
      ? { provedor: 'google_books', status: 'ok', candidatos }
      : { provedor: 'google_books', status: 'vazio' }
  } catch (e) {
    return {
      provedor: 'google_books',
      status: 'erro',
      detalhe: e instanceof Error ? e.message : 'erro desconhecido',
    }
  }
}

async function openLibraryPorTitulo(termo: string): Promise<ResultadoProvedor> {
  try {
    const res = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(termo)}&limit=8&fields=title,cover_i`
    )
    if (res.status === 429) return { provedor: 'open_library', status: 'quota', detalhe: `HTTP ${res.status}` }
    if (!res.ok) return { provedor: 'open_library', status: 'erro', detalhe: `HTTP ${res.status}` }
    const data = await res.json()
    type Doc = { title?: string; cover_i?: number }
    const docs: Doc[] = data.docs ?? []
    const candidatos: CandidatoCapa[] = docs
      .filter((d): d is Doc & { cover_i: number } => typeof d.cover_i === 'number')
      .slice(0, 8)
      .map((d) => ({
        url: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`,
        label: d.title ?? termo,
        provedor: 'open_library' as const,
      }))
    return candidatos.length > 0
      ? { provedor: 'open_library', status: 'ok', candidatos }
      : { provedor: 'open_library', status: 'vazio' }
  } catch (e) {
    return {
      provedor: 'open_library',
      status: 'erro',
      detalhe: e instanceof Error ? e.message : 'erro desconhecido',
    }
  }
}

async function anilistPorTitulo(termo: string): Promise<ResultadoProvedor> {
  const query = `
    query ($search: String) {
      Page(page: 1, perPage: 8) {
        media(search: $search, type: MANGA) {
          id
          title { romaji english }
          coverImage { large }
        }
      }
    }
  `
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { search: termo } }),
    })
    if (res.status === 429) return { provedor: 'anilist', status: 'quota', detalhe: `HTTP ${res.status}` }
    if (!res.ok) return { provedor: 'anilist', status: 'erro', detalhe: `HTTP ${res.status}` }
    const data = await res.json()
    type AniListMedia = {
      id?: number
      title?: { romaji?: string; english?: string }
      coverImage?: { large?: string }
    }
    const media: AniListMedia[] = data?.data?.Page?.media ?? []
    const candidatos: CandidatoCapa[] = media
      .filter((m) => Boolean(m.coverImage?.large))
      .map((m) => ({
        url: m.coverImage!.large!,
        label: m.title?.english || m.title?.romaji || termo,
        provedor: 'anilist' as const,
        ref: m.id != null ? String(m.id) : null,
      }))
    return candidatos.length > 0
      ? { provedor: 'anilist', status: 'ok', candidatos }
      : { provedor: 'anilist', status: 'vazio' }
  } catch (e) {
    return { provedor: 'anilist', status: 'erro', detalhe: e instanceof Error ? e.message : 'erro desconhecido' }
  }
}

/** Resolve o manga id do MangaDex por título, depois busca as capas cadastradas — filtrando por volume e preferindo locale pt-br. */
/** Busca as capas cadastradas de uma obra já resolvida no MangaDex, filtrando por volume (quando informado) e preferindo locale pt-br. */
async function mangadexCoverPorId(mangaId: string, volume: number | null): Promise<ResultadoProvedor> {
  try {
    const coverRes = await fetch(
      `https://api.mangadex.org/cover?manga[]=${mangaId}&limit=100&order[volume]=asc`,
      { headers: MANGADEX_HEADERS }
    )
    if (coverRes.status === 429) return { provedor: 'mangadex', status: 'quota', detalhe: `HTTP ${coverRes.status}` }
    if (!coverRes.ok) return { provedor: 'mangadex', status: 'erro', detalhe: `HTTP ${coverRes.status}` }
    const coverData = await coverRes.json()
    type CoverResult = { attributes?: { volume?: string | null; locale?: string; fileName?: string } }
    const covers: CoverResult[] = coverData.data ?? []

    // A API não filtra por volume de forma confiável — filtramos no cliente.
    const doVolume = volume != null ? covers.filter((c) => c.attributes?.volume === String(volume)) : []
    const pool = doVolume.length > 0 ? doVolume : covers

    const prioridadeLocale = (locale?: string) => (locale === 'pt-br' ? 0 : locale === 'pt' ? 1 : 2)
    const ordenados = [...pool].sort(
      (a, b) => prioridadeLocale(a.attributes?.locale) - prioridadeLocale(b.attributes?.locale)
    )

    const candidatos: CandidatoCapa[] = ordenados
      .filter((c): c is CoverResult & { attributes: { fileName: string } } => Boolean(c.attributes?.fileName))
      .slice(0, 8)
      .map((c) => ({
        url: `https://uploads.mangadex.org/covers/${mangaId}/${c.attributes.fileName}.512.jpg`,
        label: `vol. ${c.attributes.volume ?? '?'} (${c.attributes.locale ?? '?'})`,
        provedor: 'mangadex' as const,
        ref: mangaId,
      }))

    return candidatos.length > 0
      ? { provedor: 'mangadex', status: 'ok', candidatos }
      : { provedor: 'mangadex', status: 'vazio' }
  } catch (e) {
    return { provedor: 'mangadex', status: 'erro', detalhe: e instanceof Error ? e.message : 'erro desconhecido' }
  }
}

/** Resolve o manga id do MangaDex por título (pulando a resolução quando `refConhecido` já vem da memória da série), depois busca as capas. */
async function mangadexPorTitulo(
  termo: string,
  volume: number | null,
  refConhecido?: string | null
): Promise<ResultadoProvedor> {
  let mangaId = refConhecido ?? null

  if (!mangaId) {
    try {
      const res = await fetch(
        `https://api.mangadex.org/manga?title=${encodeURIComponent(termo)}&limit=5&includes[]=cover_art`,
        { headers: MANGADEX_HEADERS }
      )
      if (res.status === 429) return { provedor: 'mangadex', status: 'quota', detalhe: `HTTP ${res.status}` }
      if (!res.ok) return { provedor: 'mangadex', status: 'erro', detalhe: `HTTP ${res.status}` }
      const data = await res.json()
      type MangaResult = { id: string }
      const resultados: MangaResult[] = data.data ?? []
      mangaId = resultados[0]?.id ?? null
      if (!mangaId) return { provedor: 'mangadex', status: 'vazio' }
    } catch (e) {
      return { provedor: 'mangadex', status: 'erro', detalhe: e instanceof Error ? e.message : 'erro desconhecido' }
    }
  }

  return mangadexCoverPorId(mangaId, volume)
}

/**
 * Atalho de baixo custo: quando a série já tem provedor/ref conhecidos
 * (memória gravada por uma busca anterior), busca a capa exata do volume sem
 * repetir a resolução por título. Usado no importador em lote, onde a busca
 * livre por título é ambígua demais para aplicar sem revisão.
 */
export async function buscarCapaPorMemoria(
  memoria: MemoriaSerie,
  volume: number | null
): Promise<CandidatoCapa | null> {
  if (memoria.provedor === 'mangadex' && memoria.ref) {
    const resultado = await mangadexCoverPorId(memoria.ref, volume)
    if (resultado.status === 'ok') return resultado.candidatos[0]
  }
  return null
}

/**
 * Busca por título, acumulando candidatos de todos os provedores da cascata
 * (um provedor com quota estourada não derruba a busca inteira) e reportando
 * o que aconteceu em cada um para a UI poder distinguir "sem capa" de "fonte falhou".
 */
export async function buscarCandidatos(
  termo: TermoBusca,
  tipo: TipoObra,
  memoria?: MemoriaSerie | null
): Promise<{ candidatos: CandidatoCapa[]; diagnostico: ResultadoProvedor[] }> {
  const buscas: Array<() => Promise<ResultadoProvedor>> =
    tipo === 'manga'
      ? [
          () => mangadexPorTitulo(termo.termo, termo.volume, memoria?.provedor === 'mangadex' ? memoria.ref : null),
          () => anilistPorTitulo(termo.termo),
        ]
      : [() => googleBooksPorTitulo(termo.termo), () => openLibraryPorTitulo(termo.termo)]

  const diagnostico: ResultadoProvedor[] = []
  const candidatos: CandidatoCapa[] = []
  const urlsVistas = new Set<string>()

  for (const busca of buscas) {
    const resultado = await busca()
    diagnostico.push(resultado)

    if (resultado.status === 'quota' || resultado.status === 'erro') {
      console.warn(
        `[capa-busca] ${resultado.provedor}: ${resultado.status}${resultado.detalhe ? ` — ${resultado.detalhe}` : ''}`
      )
    }

    if (resultado.status === 'ok') {
      for (const c of resultado.candidatos) {
        if (urlsVistas.has(c.url)) continue
        urlsVistas.add(c.url)
        candidatos.push(c)
        if (candidatos.length >= TETO_CANDIDATOS) break
      }
    }

    if (candidatos.length >= TETO_CANDIDATOS) break
  }

  return { candidatos, diagnostico }
}

const PROVEDOR_LABEL: Record<Provedor, string> = {
  google_books: 'Google Books',
  open_library: 'Open Library',
  anilist: 'AniList',
  mangadex: 'MangaDex',
}

/** Mensagem amigável quando a busca falhou por causa da FONTE (quota/erro) — para não confundir com "capa não existe". */
export function descreverFalhaProvedor(diagnostico: ResultadoProvedor[]): string | null {
  const comQuota = diagnostico.find((d) => d.status === 'quota')
  if (comQuota) {
    const dica = comQuota.provedor === 'google_books' ? ' ou configure GOOGLE_BOOKS_API_KEY' : ''
    return `${PROVEDOR_LABEL[comQuota.provedor]} está com a quota esgotada — tente mais tarde${dica}.`
  }
  const comErro = diagnostico.find((d) => d.status === 'erro')
  if (comErro) {
    return `${PROVEDOR_LABEL[comErro.provedor]} falhou ao responder — tente novamente em instantes.`
  }
  return null
}

const LIMITE_BYTES_CAPA = 5 * 1024 * 1024
const MAX_REDIRECTS = 3
const TIMEOUT_DOWNLOAD_MS = 15_000

/** Hosts de onde as capas podem vir (os mesmos dos provedores da cascata). Open Library redireciona para archive.org e seus subdomínios. */
const HOSTS_CAPA_EXATOS = new Set([
  'books.google.com',
  'covers.openlibrary.org',
  'uploads.mangadex.org',
])
const DOMINIOS_CAPA = ['googleusercontent.com', 'anilist.co', 'archive.org']

/** Só https e só hosts conhecidos: a URL pode vir do cliente (aplicarCapaEscolhida), então nunca confiamos nela. */
export function urlDeCapaPermitida(valor: string): URL | null {
  let url: URL
  try {
    url = new URL(valor)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (url.port && url.port !== '443') return null
  const host = url.hostname.toLowerCase()
  const ok = HOSTS_CAPA_EXATOS.has(host) || DOMINIOS_CAPA.some((d) => host === d || host.endsWith(`.${d}`))
  return ok ? url : null
}

const EXT_POR_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** Baixa com limites: allowlist a cada salto de redirect, timeout, teto de bytes e MIME de imagem. */
async function baixarImagemSegura(imageUrl: string): Promise<{ buffer: Uint8Array; mime: string } | null> {
  let atual = urlDeCapaPermitida(imageUrl)
  if (!atual) return null

  for (let salto = 0; salto <= MAX_REDIRECTS; salto++) {
    const res = await fetch(atual, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_DOWNLOAD_MS) })

    if (res.status >= 300 && res.status < 400) {
      const destino = res.headers.get('location')
      if (!destino) return null
      atual = urlDeCapaPermitida(new URL(destino, atual).toString())
      if (!atual) return null
      continue
    }
    if (!res.ok || !res.body) return null

    const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!EXT_POR_MIME[mime]) return null
    const declarado = Number(res.headers.get('content-length') || 0)
    if (declarado > LIMITE_BYTES_CAPA) return null

    const partes: Uint8Array[] = []
    let total = 0
    const reader = res.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > LIMITE_BYTES_CAPA) {
        await reader.cancel()
        return null
      }
      partes.push(value)
    }
    const buffer = new Uint8Array(total)
    let offset = 0
    for (const parte of partes) {
      buffer.set(parte, offset)
      offset += parte.byteLength
    }
    return { buffer, mime }
  }
  return null
}

/** Baixa uma imagem externa (host permitido) e persiste no bucket privado 'capas'. Retorna o path salvo (não a URL — bucket é privado). */
export async function baixarEPersistirCapa(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  itemId: string,
  imageUrl: string
): Promise<string | null> {
  try {
    const baixada = await baixarImagemSegura(imageUrl)
    if (!baixada) return null
    const path = novoCaminhoDeCapa(userId, itemId, EXT_POR_MIME[baixada.mime])
    const { error } = await supabase.storage
      .from('capas')
      .upload(path, baixada.buffer, { upsert: true, contentType: baixada.mime })
    if (error) return null
    return path
  } catch {
    return null
  }
}
