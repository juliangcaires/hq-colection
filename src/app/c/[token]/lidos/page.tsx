import { createAnonClient } from '@/lib/supabase/anon'
import { PaginaLidos } from '@/components/vitrine/paginas'
import { lerLimite } from '@/lib/filtros-url'
import { lerLink } from '../dados'

export default async function Pagina({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ limite?: string }> }) {
  const { token } = await params
  const link = await lerLink(token)
  if (link.estado !== 'ok') return null
  return <PaginaLidos supabase={createAnonClient()} fonte={{ tipo: 'link', token }} resumo={link.resumo} limite={lerLimite((await searchParams).limite)} />
}
