import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { carregarFavoritosDoAmigo, type FavoritoSerie } from '@/lib/favoritos-series'
import { carregarResumo, type ResumoVitrine } from '@/lib/vitrine'

/** Resumo do amigo (null = não existe ou não são amigos aceitos: a página vira 404, sem distinguir os casos). */
export const lerAmigo = cache(async (apelido: string): Promise<ResumoVitrine | null> => {
  const supabase = await createClient()
  return carregarResumo(supabase, { tipo: 'amigo', apelido })
})

/** Séries favoritas do amigo (vazio sem favoritos, sem a seção "séries" liberada ou se a leitura falhar: o perfil abre mesmo assim). */
export const lerFavoritosDoAmigo = cache(async (apelido: string): Promise<FavoritoSerie[]> => {
  try {
    return await carregarFavoritosDoAmigo(await createClient(), apelido)
  } catch (e) {
    console.error('[favoritos] não carregou os favoritos do amigo', e)
    return []
  }
})
