import { cache } from 'react'
import { headers } from 'next/headers'
import { createAnonClient } from '@/lib/supabase/anon'
import { limitePaginas } from '@/lib/limite-taxa'
import { tokenValido } from '@/lib/compartilhamento'
import { carregarFavoritosDoLink, type Favorito } from '@/lib/favoritos'
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

/**
 * Favoritos do dono visíveis neste link (séries e volumes únicos, no escopo do link). Uma leitura por requisição.
 * Vazio sem favoritos visíveis ou se a leitura falhar: a coleção compartilhada abre mesmo assim.
 */
export const lerFavoritosDoLink = cache(async (token: string): Promise<Favorito[]> => {
  try {
    return await carregarFavoritosDoLink(createAnonClient(), token)
  } catch (e) {
    console.error('[favoritos] não carregou os favoritos do link', e)
    return []
  }
})
