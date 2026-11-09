import type { SupabaseClient } from '@supabase/supabase-js'

const MIME_POR_EXT: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Servico = SupabaseClient<any>

/**
 * Baixa do bucket privado `capas` o arquivo que o BANCO autorizou (`caminho` vem de `link_capa`/`amigo_capa`,
 * nunca da URL) e o devolve como imagem. Cache curto e privado: se o acesso for revogado, a capa para de
 * aparecer em minutos mesmo em quem já a viu.
 */
export async function servirCapaAutorizada(servico: Servico | null, caminho: string): Promise<Response> {
  if (!servico) {
    console.warn('[capa compartilhada] SUPABASE_SERVICE_ROLE_KEY não configurada: capas privadas não são servidas.')
    return new Response('Not found', { status: 404 })
  }
  const ext = caminho.split('.').pop() ?? ''
  const mime = MIME_POR_EXT[ext]
  if (!mime) return new Response('Not found', { status: 404 })

  const { data: blob, error } = await servico.storage.from('capas').download(caminho)
  if (error || !blob) return new Response('Not found', { status: 404 })

  return new Response(blob.stream(), {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
