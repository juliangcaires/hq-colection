import type { SupabaseClient } from '@supabase/supabase-js'

/** Nome único por gravação: o conteúdo de um arquivo nunca muda, então o navegador pode guardá-lo para sempre. */
export function novoCaminhoDeCapa(userId: string, itemId: string, ext: string): string {
  return `${userId}/${itemId}-${Date.now()}.${ext}`
}

/**
 * URL estável (`/api/capa/<arquivo>`) de cada caminho salvo em `itens.capa_url`.
 * Substitui as signed URLs, que mudavam a cada renderização (cache do navegador sempre perdia),
 * custavam uma chamada ao Storage por página e falhavam em silêncio com muitos itens.
 */
export function urlsDeCapas(paths: (string | null)[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const path of paths) {
    if (!path) continue
    map.set(path, ehCapaPublica(path) ? urlPublicaDeCapa(path) : `/api/capa/${path.split('/').pop()}`)
  }
  return map
}

/** `itens.capa_url` que aponta para o catálogo público (`pub/<hash>.<ext>`) em vez do bucket privado do usuário. */
export function ehCapaPublica(path: string): boolean {
  return path.startsWith('pub/')
}

/**
 * URL direta do arquivo no bucket público `capas-publicas` (cache de CDN; o nome é o hash, então nunca muda).
 * Só aceita o formato exato `pub/<sha256>.<jpg|png|webp>`: qualquer outra coisa vira vazio em vez de URL solta.
 */
export function urlPublicaDeCapa(path: string): string {
  const m = /^pub\/([0-9a-f]{64}\.(?:jpg|png|webp))$/.exec(path)
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  if (!m || !base) return ''
  return `${base}/storage/v1/object/public/capas-publicas/${m[1]}`
}

/** Apaga o arquivo antigo da capa quando um novo (com outro caminho/extensão) o substituiu. Falha aqui não deve quebrar a operação. */
export async function removerCapaAntiga(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  caminhoAntigo: string | null | undefined,
  caminhoNovo: string | null
): Promise<void> {
  if (!caminhoAntigo || caminhoAntigo === caminhoNovo) return
  // Capa do catálogo público é contribuição compartilhada: trocar ou apagar o item nunca a remove.
  if (caminhoAntigo.startsWith('pub/')) return
  const { error } = await supabase.storage.from('capas').remove([caminhoAntigo])
  if (error) console.error('[capas] não removeu arquivo antigo', caminhoAntigo, error.message)
}
