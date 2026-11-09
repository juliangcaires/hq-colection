import { createClient } from '@/lib/supabase/server'
import { PaginaSeries } from '@/components/vitrine/paginas'
import { lerAmigo } from '../dados'

export default async function Pagina({ params }: { params: Promise<{ apelido: string }> }) {
  const { apelido } = await params
  const resumo = await lerAmigo(apelido)
  if (!resumo) return null
  return <PaginaSeries supabase={await createClient()} fonte={{ tipo: 'amigo', apelido }} resumo={resumo} />
}
