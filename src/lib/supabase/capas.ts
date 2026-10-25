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
    if (path) map.set(path, `/api/capa/${path.split('/').pop()}`)
  }
  return map
}

/** Apaga o arquivo antigo da capa quando um novo (com outro caminho/extensão) o substituiu. Falha aqui não deve quebrar a operação. */
export async function removerCapaAntiga(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  caminhoAntigo: string | null | undefined,
  caminhoNovo: string | null
): Promise<void> {
  if (!caminhoAntigo || caminhoAntigo === caminhoNovo) return
  const { error } = await supabase.storage.from('capas').remove([caminhoAntigo])
  if (error) console.error('[capas] não removeu arquivo antigo', caminhoAntigo, error.message)
}
