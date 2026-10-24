import { createClient } from '@/lib/supabase/server'

// `<uuid>[-<carimbo>].<jpg|png|webp>`: o nome do arquivo guardado em `itens.capa_url`, sem a pasta do usuário.
const NOME_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-\d{10,16})?\.(jpg|png|webp)$/
const MIME_POR_EXT: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

/**
 * Serve a capa do usuário logado com URL estável e cache longo.
 *
 * A pasta vem do JWT (`sub`), nunca da URL, e a RLS do Storage confere de novo: um usuário
 * não consegue pedir arquivo de outro. O conteúdo de um nome nunca muda (cada gravação gera
 * um nome novo), por isso `immutable`.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ arquivo: string }> }) {
  const { arquivo } = await params
  if (!NOME_VALIDO.test(arquivo)) return new Response('Not found', { status: 404 })

  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const userId = data?.claims.sub
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const { data: blob, error } = await supabase.storage.from('capas').download(`${userId}/${arquivo}`)
  if (error || !blob) return new Response('Not found', { status: 404 })

  return new Response(blob.stream(), {
    headers: {
      'Content-Type': MIME_POR_EXT[arquivo.split('.').pop()!],
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
