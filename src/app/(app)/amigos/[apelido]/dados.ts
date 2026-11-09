import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { carregarResumo, type ResumoVitrine } from '@/lib/vitrine'

/** Resumo do amigo (null = não existe ou não são amigos aceitos: a página vira 404, sem distinguir os casos). */
export const lerAmigo = cache(async (apelido: string): Promise<ResumoVitrine | null> => {
  const supabase = await createClient()
  return carregarResumo(supabase, { tipo: 'amigo', apelido })
})
