import { createAnonClient } from '@/lib/supabase/anon'
import { createServiceClient } from '@/lib/supabase/servico'
import { limiteCapas } from '@/lib/limite-taxa'
import { tokenValido } from '@/lib/compartilhamento'
import { ARQUIVO_DE_CAPA } from '@/lib/vitrine'
import { servirCapaAutorizada } from '@/lib/servir-capa'

/**
 * Capa privada de uma coleção compartilhada por link. Só serve o arquivo se o BANCO disser que algum item
 * visível no escopo daquele token o usa (`link_capa`); token revogado, arquivo de item fora do escopo ou
 * nome fora do padrão = 404. Há limite de requisições por token.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; arquivo: string }> }) {
  const { token, arquivo } = await params
  if (!tokenValido(token) || !ARQUIVO_DE_CAPA.test(arquivo)) return new Response('Not found', { status: 404 })

  if (!limiteCapas.tentar(`t:${token}`).ok) {
    return new Response('Too many requests', { status: 429, headers: { 'Retry-After': '30' } })
  }

  const { data: caminho, error } = await createAnonClient().rpc('link_capa', { p_token: token, p_arquivo: arquivo })
  if (error || typeof caminho !== 'string' || !caminho) return new Response('Not found', { status: 404 })

  return servirCapaAutorizada(createServiceClient(), caminho)
}
