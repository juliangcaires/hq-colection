import { cache } from 'react'
import { headers } from 'next/headers'
import { createAnonClient } from '@/lib/supabase/anon'
import { limitePaginas } from '@/lib/limite-taxa'
import { tokenValido } from '@/lib/compartilhamento'
import { carregarResumo, type ResumoVitrine } from '@/lib/vitrine'

export type EstadoDoLink =
  | { estado: 'ok'; resumo: ResumoVitrine }
  | { estado: 'invalido' }
  | { estado: 'limitado' }

/**
 * Valida o link uma vez por requisição (layout e página compartilham o resultado): formato do token,
 * limite de visitas por token e existência/revogação no banco. Chama `headers()`, o que também garante
 * renderização dinâmica — um link revogado nunca é servido de cache.
 */
export const lerLink = cache(async (token: string): Promise<EstadoDoLink> => {
  await headers()
  if (!tokenValido(token)) return { estado: 'invalido' }
  if (!limitePaginas.tentar(`t:${token}`).ok) return { estado: 'limitado' }
  const resumo = await carregarResumo(createAnonClient(), { tipo: 'link', token })
  return resumo ? { estado: 'ok', resumo } : { estado: 'invalido' }
})
