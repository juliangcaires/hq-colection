import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listarItem } from '@/lib/queries'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { ItemForm } from '@/components/itens/item-form'
import { uuidOuNull } from '@/lib/filtros-url'
import { ScrollRestore } from '@/components/ui/scroll-restore'

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const id = uuidOuNull((await params).id)
  if (!id) notFound()
  const supabase = await createClient()

  const item = await listarItem(supabase, id)
  if (!item) notFound()

  const [{ data: seriesData }, capaMap] = await Promise.all([
    supabase.from('series').select('id, nome').order('nome'),
    urlsDeCapas([item.capa_url]),
  ])

  const capaUrl = capaMap.get(item.capa_url ?? '') ?? null

  return (
    <div className="mx-auto max-w-2xl">
      <ScrollRestore />
      <ItemForm item={item} capaUrl={capaUrl} series={seriesData ?? []} />
    </div>
  )
}
