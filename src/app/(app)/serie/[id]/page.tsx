import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listarItens } from '@/lib/queries'
import { getSignedCapaUrls } from '@/lib/supabase/capas'
import { calcularVolumesFaltantes } from '@/lib/volumes'
import { SerieForm } from '@/components/series/serie-form'
import { ItemCard } from '@/components/itens/item-card'
import { BackButton } from '@/components/ui/back-button'

const MAX_FALTANTES_EXIBIDOS = 30

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

  const volumesFaltantes = calcularVolumesFaltantes(
    itens.map((i) => i.numero_volume),
    serie.total_volumes
  )
  const faltantesExibidos = volumesFaltantes.slice(0, MAX_FALTANTES_EXIBIDOS)
  const faltantesOcultos = volumesFaltantes.length - faltantesExibidos.length

  return (
    <div className="flex flex-col gap-6">
      <BackButton />
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">{serie.nome}</h1>
        <p className="text-sm text-muted-foreground">
          {itens.length} volume(ns) na coleção
          {serie.total_volumes ? ` de ${serie.total_volumes}` : ''}
        </p>
        {volumesFaltantes.length > 0 && (
          <p className="mt-2 text-sm text-amber-400">
            <span className="font-medium">Faltam {volumesFaltantes.length}:</span>{' '}
            {faltantesExibidos.join(', ')}
            {faltantesOcultos > 0 ? ` e mais ${faltantesOcultos}` : ''}
          </p>
        )}
      </div>

      <SerieForm serie={{ ...serie, tagIds }} allTags={allTags ?? []} />

      <div>
        <h2 className="font-heading mb-3 text-sm font-semibold text-foreground/90">Volumes</h2>
        {itens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum volume desta série na sua coleção ainda.</p>
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
