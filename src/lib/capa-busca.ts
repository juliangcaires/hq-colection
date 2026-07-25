import type { SupabaseClient } from '@supabase/supabase-js'
import type { TipoObra } from '@/lib/types'

export type CandidatoCapa = { url: string; label: string }

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

/** Cascata ISBN: Google Books, depois Open Library Covers. Retorna a 1a imagem encontrada (melhor taxa de acerto — não é ambíguo). */
export async function buscarCapaPorIsbn(isbn: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`
    )
    if (res.ok) {
      const data = await res.json()
      const item: GoogleBooksItem | undefined = data.items?.[0]
      const url = melhorImagemGoogleBooks(item?.volumeInfo?.imageLinks)
      if (url) return url
    }
  } catch {
    // segue para o próximo da cascata
  }

  const olUrl = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg`
  try {
    const res = await fetch(olUrl)
    if (res.ok) {
      const buf = await res.arrayBuffer()
      // Open Library devolve um placeholder minúsculo quando não tem capa
      if (buf.byteLength > 1000) return olUrl
    }
  } catch {
    // sem sorte
  }

  return null
}

/** Busca por título em HQ via Google Books — tende a ser ambíguo, retorna candidatos. */
export async function buscarCapaHqPorTitulo(titulo: string): Promise<CandidatoCapa[]> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(titulo)}&maxResults=8`
    )
    if (!res.ok) return []
    const data = await res.json()
    const items: GoogleBooksItem[] = data.items ?? []
    return items
      .map((it) => {
        const url = melhorImagemGoogleBooks(it.volumeInfo?.imageLinks)
        if (!url) return null
        return { url, label: it.volumeInfo?.title ?? titulo }
      })
      .filter((c): c is CandidatoCapa => c !== null)
      .slice(0, 8)
  } catch {
    return []
  }
}

/** Busca por título em mangá via AniList (GraphQL público, sem chave). */
export async function buscarCapaMangaPorTitulo(titulo: string): Promise<CandidatoCapa[]> {
  const query = `
    query ($search: String) {
      Page(page: 1, perPage: 8) {
        media(search: $search, type: MANGA) {
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
      body: JSON.stringify({ query, variables: { search: titulo } }),
    })
    if (!res.ok) return []
    const data = await res.json()
    type AniListMedia = { title?: { romaji?: string; english?: string }; coverImage?: { large?: string } }
    const media: AniListMedia[] = data?.data?.Page?.media ?? []
    return media
      .filter((m) => Boolean(m.coverImage?.large))
      .map((m) => ({
        url: m.coverImage!.large!,
        label: m.title?.english || m.title?.romaji || titulo,
      }))
  } catch {
    return []
  }
}

export async function buscarCapaPorTitulo(titulo: string, tipo: TipoObra): Promise<CandidatoCapa[]> {
  return tipo === 'manga' ? buscarCapaMangaPorTitulo(titulo) : buscarCapaHqPorTitulo(titulo)
}

/** Baixa uma imagem externa e persiste no bucket privado 'capas'. Retorna o path salvo (não a URL — bucket é privado). */
export async function baixarEPersistirCapa(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  itemId: string,
  imageUrl: string
): Promise<string | null> {
  try {
    const res = await fetch(imageUrl)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
    const buffer = await res.arrayBuffer()
    const path = `${userId}/${itemId}.${ext}`
    const { error } = await supabase.storage
      .from('capas')
      .upload(path, buffer, { upsert: true, contentType })
    if (error) return null
    return path
  } catch {
    return null
  }
}
