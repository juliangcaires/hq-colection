import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listarItem } from '@/lib/queries'
import { getSignedCapaUrls } from '@/lib/supabase/capas'
import { ItemForm } from '@/components/itens/item-form'

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const item = await listarItem(supabase, id)
  if (!item) notFound()

  const [{ data: seriesData }, { data: tagsData }, capaMap] = await Promise.all([
    supabase.from('series').select('id, nome').order('nome'),
    supabase.from('tags').select('id, nome, tipo, cor').order('nome'),
    getSignedCapaUrls(supabase, [item.capa_url]),
  ])

  const capaUrl = capaMap.get(item.capa_url ?? '') ?? null

  return (
    <div className="mx-auto max-w-2xl">
      <ItemForm item={item} capaUrl={capaUrl} series={seriesData ?? []} allTags={tagsData ?? []} />
    </div>
  )
}
