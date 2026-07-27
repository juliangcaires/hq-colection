import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listarItens } from '@/lib/queries'
import { getSignedCapaUrls } from '@/lib/supabase/capas'
import { calcularVolumesFaltantes } from '@/lib/volumes'
import { SerieForm } from '@/components/series/serie-form'
import { AdicionarVolumesDialog } from '@/components/series/adicionar-volumes-dialog'
import { VolumesGrid } from '@/components/series/volumes-grid'
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

  const volumesFaltantes = calcularVolumesFaltantes(itens, serie.total_volumes)
  const possuidos = itens.filter((i) => i.estado !== 'desejo').length
  const desejados = itens.length - possuidos
  const faltantesExibidos = volumesFaltantes.slice(0, MAX_FALTANTES_EXIBIDOS)
  const faltantesOcultos = volumesFaltantes.length - faltantesExibidos.length

  return (
    <div className="flex flex-col gap-6">
      <BackButton />
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">{serie.nome}</h1>
        <p className="text-sm text-muted-foreground">
          {/* Só os adquiridos contam aqui, senão a conta não fecha com os furos:
              um volume só desejado apareceria ao mesmo tempo como tido e faltante. */}
          {possuidos} volume(ns) na coleção
          {serie.total_volumes ? ` de ${serie.total_volumes}` : ''}
          {desejados > 0 ? ` · ${desejados} na lista de desejos` : ''}
        </p>
        {volumesFaltantes.length > 0 && (
          <p className="mt-2 text-sm text-amber-400">
            <span className="font-medium">
              {volumesFaltantes.length === 1 ? 'Falta 1:' : `Faltam ${volumesFaltantes.length}:`}
            </span>{' '}
            {faltantesExibidos.map((n) => `#${n}`).join(', ')}
            {faltantesOcultos > 0 ? ` e mais ${faltantesOcultos}` : ''}
          </p>
        )}
      </div>

      <SerieForm serie={{ ...serie, tagIds }} allTags={allTags ?? []} />

      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-semibold text-foreground/90">Volumes</h2>
          <AdicionarVolumesDialog
            serieId={id}
            serieNome={serie.nome}
            temNumeracao={Boolean(serie.tem_numeracao)}
            numerosOcupados={itens
              .map((i) => i.numero_volume)
              .filter((n): n is number => n !== null)}
            tags={allTags ?? []}
          />
        </div>
        {itens.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum volume desta série na sua coleção ainda. Use &ldquo;Adicionar volumes&rdquo; para
            agrupar itens que você já tem.
          </p>
        ) : (
          <VolumesGrid serieId={id} itens={itens} capas={Array.from(capaMap.entries())} />
        )}
      </div>
    </div>
  )
}
