import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/servico'
import { ARQUIVO_DE_CAPA } from '@/lib/vitrine'
import { servirCapaAutorizada } from '@/lib/servir-capa'

/**
 * Capa privada de um amigo. O banco só devolve o caminho se vocês forem amigos aceitos e algum item
 * visível no escopo de amigos usar o arquivo; fora disso, 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ apelido: string; arquivo: string }> }) {
  const { apelido, arquivo } = await params
  if (!/^[a-z0-9_]{3,30}$/.test(apelido) || !ARQUIVO_DE_CAPA.test(arquivo)) return new Response('Not found', { status: 404 })

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims.sub) return new Response('Unauthorized', { status: 401 })

  const { data: caminho, error } = await supabase.rpc('amigo_capa', { p_apelido: apelido, p_arquivo: arquivo })
  if (error || typeof caminho !== 'string' || !caminho) return new Response('Not found', { status: 404 })

  return servirCapaAutorizada(createServiceClient(), caminho)
}
