import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PaginaColecao } from '@/components/vitrine/paginas'
import { SECOES_DA_VITRINE } from '@/components/vitrine/vitrine-nav'
import { lerLimite } from '@/lib/filtros-url'
import { lerAmigo } from './dados'

export default async function PaginaInicialDoAmigo({ params, searchParams }: { params: Promise<{ apelido: string }>; searchParams: Promise<{ limite?: string }> }) {
  const { apelido } = await params
  const resumo = await lerAmigo(apelido)
  if (!resumo) return null

  if (!resumo.escopo.includes('colecao')) {
    const primeira = SECOES_DA_VITRINE.find((s) => resumo.escopo.includes(s.requer) && s.sufixo !== '')
    if (primeira) redirect(`/amigos/${apelido}${primeira.sufixo}`)
    return <p className="text-sm text-muted-foreground">Seu amigo ainda não liberou nenhuma seção.</p>
  }
  return <PaginaColecao supabase={await createClient()} fonte={{ tipo: 'amigo', apelido }} resumo={resumo} limite={lerLimite((await searchParams).limite)} />
}
