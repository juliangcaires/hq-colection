import { createClient } from '@/lib/supabase/server'
import { PaginaRanking } from '@/components/vitrine/paginas'
import { lerLimiteRanking } from '@/lib/filtros-url'
import { lerAmigo } from '../dados'

export default async function Pagina({ params, searchParams }: { params: Promise<{ apelido: string }>; searchParams: Promise<{ limite?: string }> }) {
  const { apelido } = await params
  const resumo = await lerAmigo(apelido)
  if (!resumo) return null
  return <PaginaRanking supabase={await createClient()} fonte={{ tipo: 'amigo', apelido }} resumo={resumo} limite={lerLimiteRanking((await searchParams).limite)} />
}
