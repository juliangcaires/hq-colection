import type { SupabaseClient } from '@supabase/supabase-js'
import { progressoDeContagens, type ProgressoDaSerie } from '@/lib/progresso-serie'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

/** Linha de `series_com_resumo` (migration 0027) → progresso. Aceita o que o banco devolve, inclusive nulos. */
export function progressoDaLinhaDoResumo(r: Record<string, unknown>): ProgressoDaSerie {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return progressoDeContagens({
    tenho: n(r.tenho) ?? 0,
    lidos: n(r.lidos_n) ?? 0,
    totalDeclarado: n(r.total_volumes),
    maximoConhecido: n(r.maximo_conhecido),
  })
}

/** Progresso de todas as SUAS séries (a RPC é `security invoker`: só enxerga as séries do próprio usuário). */
export async function carregarProgressoDasSeries(supabase: Cliente): Promise<Map<string, ProgressoDaSerie>> {
  const { data, error } = await supabase.rpc('series_com_resumo', { p_padrao: null })
  if (error) throw new Error(error.message)
  return new Map(((data ?? []) as Record<string, unknown>[]).map((r) => [String(r.id), progressoDaLinhaDoResumo(r)]))
}
