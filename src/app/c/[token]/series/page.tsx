import { createAnonClient } from '@/lib/supabase/anon'
import { PaginaSeries } from '@/components/vitrine/paginas'
import { lerLink } from '../dados'

export default async function Pagina({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = await lerLink(token)
  if (link.estado !== 'ok') return null
  return <PaginaSeries supabase={createAnonClient()} fonte={{ tipo: 'link', token }} resumo={link.resumo} />
}
