import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/servico'
import { servirCapaAutorizada } from '@/lib/servir-capa'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Capa privada de um item de lista. O banco só devolve o caminho se a lista estiver visível para quem pede
 * (dono ou amigo aceito, conferido agora); fora disso, 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ item: string }> }) {
  const { item } = await params
  if (!UUID.test(item)) return new Response('Not found', { status: 404 })

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims.sub) return new Response('Unauthorized', { status: 401 })

  const { data: caminho, error } = await supabase.rpc('lista_item_capa', { p_item: item })
  if (error || typeof caminho !== 'string' || !caminho) return new Response('Not found', { status: 404 })

  return servirCapaAutorizada(createServiceClient(), caminho)
}
