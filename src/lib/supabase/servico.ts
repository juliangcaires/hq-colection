import { createClient } from '@supabase/supabase-js'

/**
 * Cliente com a chave de serviço (ignora a RLS e o Storage privado). Uso restrito: só depois que uma função
 * do banco autorizou o acesso e devolveu o caminho exato do arquivo (capas de coleções compartilhadas).
 * Sem `SUPABASE_SERVICE_ROLE_KEY` devolve null e quem chama trata como "capa indisponível".
 * Nunca importar em componente de cliente.
 */
export function createServiceClient() {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!chave || !url) return null
  return createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } })
}
