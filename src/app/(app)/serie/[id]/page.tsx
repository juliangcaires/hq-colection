import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listarItens } from '@/lib/queries'
import { getSignedCapaUrls } from '@/lib/supabase/capas'
import { SerieForm } from '@/components/series/serie-form'
import { ItemCard } from '@/components/itens/item-card'

export default async function SeriePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: serie } = await supabase
    .from('series')
    .select('*, serie_tags(tag_id)')
    .eq('id', id)
    .maybeSingle()

  if (!serie) notFound()

  const [itens, { data: allTags }] = await Promise.all([
    listarItens(supabase, { serieId: id }, { column: 'numero_volume', ascending: true }),
    supabase.from('tags').select('id, nome, tipo, cor').order('nome'),
  ])

  const capaMap = await getSignedCapaUrls(
    supabase,
    itens.map((i) => i.capa_url)
  )

  const tagIds = (serie.serie_tags ?? []).map((st: { tag_id: string }) => st.tag_id)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{serie.nome}</h1>
        <p className="text-sm text-neutral-500">
          {itens.length} volume(ns) na coleção
          {serie.total_volumes ? ` de ${serie.total_volumes}` : ''}
        </p>
      </div>

      <SerieForm serie={{ ...serie, tagIds }} allTags={allTags ?? []} />

      <div>
        <h2 className="mb-3 text-sm font-semibold text-neutral-300">Volumes</h2>
        {itens.length === 0 ? (
          <p className="text-sm text-neutral-500">Nenhum volume desta série na sua coleção ainda.</p>
        ) : (
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {itens.map((item) => (
              <ItemCard key={item.id} item={item} capaUrl={capaMap.get(item.capa_url ?? '') ?? null} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
