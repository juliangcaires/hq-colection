import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente sem sessão (papel `anon`) para as páginas públicas. Não lê nem grava cookies, então o resultado
 * nunca depende de quem está logado: o visitante vê exatamente o que o link permite.
 */
export function createAnonClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
