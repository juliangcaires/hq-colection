import { redirect } from 'next/navigation'
import { createAnonClient } from '@/lib/supabase/anon'
import { PaginaColecao } from '@/components/vitrine/paginas'
import { SECOES_DA_VITRINE } from '@/components/vitrine/vitrine-nav'
import { lerLimite } from '@/lib/filtros-url'
import { lerLink } from './dados'

export default async function PaginaInicialDoLink({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ limite?: string }> }) {
  const { token } = await params
  const link = await lerLink(token)
  if (link.estado !== 'ok') return null
  const { resumo } = link

  // Sem "Coleção" no escopo, a página inicial vai para a primeira seção liberada.
  if (!resumo.escopo.includes('colecao')) {
    const primeira = SECOES_DA_VITRINE.find((s) => resumo.escopo.includes(s.requer) && s.sufixo !== '')
    if (primeira) redirect(`/c/${token}${primeira.sufixo}`)
    return <p className="text-sm text-muted-foreground">Nada para mostrar por aqui.</p>
  }
  return <PaginaColecao supabase={createAnonClient()} fonte={{ tipo: 'link', token }} resumo={resumo} limite={lerLimite((await searchParams).limite)} />
}
