import type { SupabaseClient } from '@supabase/supabase-js'

const EXPIRA_EM_SEGUNDOS = 60 * 60 // 1h — bucket 'capas' é privado

/** Gera signed URLs em lote para paths salvos em itens.capa_url (bucket privado). */
export async function getSignedCapaUrls(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  paths: (string | null)[]
): Promise<Map<string, string>> {
  const validPaths = Array.from(new Set(paths.filter((p): p is string => Boolean(p))))
  if (validPaths.length === 0) return new Map()

  const { data, error } = await supabase.storage.from('capas').createSignedUrls(validPaths, EXPIRA_EM_SEGUNDOS)
  if (error) return new Map()

  const map = new Map<string, string>()
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map.set(item.path, item.signedUrl)
  }
  return map
}
