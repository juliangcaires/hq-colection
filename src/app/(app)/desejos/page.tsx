import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import { listarItens } from '@/lib/queries'
import { getSignedCapaUrls } from '@/lib/supabase/capas'
import { ColecaoFilters } from '@/components/itens/colecao-filters'
import { AdquirirButton } from '@/components/itens/adquirir-button'
import { ScrollRestore } from '@/components/itens/scroll-restore'
import { parseTagsPorTipoDaUrl } from '@/lib/tags-por-tipo'
import type { TipoObra } from '@/lib/types'

type SearchParams = {
  busca?: string
  tipo?: string
  serie?: string
  capa?: string
  editora?: string
  personagem?: string
  arco?: string
  selo?: string
  autor?: string
  universo?: string
  outro?: string
}

export default async function DesejosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const [itens, { data: seriesData }, { data: tagsData }] = await Promise.all([
    listarItens(
      supabase,
      {
        estado: 'desejo',
        tipo: (params.tipo as TipoObra) || undefined,
        serieId: params.serie || undefined,
        busca: params.busca || undefined,
        semCapa: params.capa === 'sem',
        tagsPorTipo: parseTagsPorTipoDaUrl(params),
      },
      { column: 'prioridade', ascending: false }
    ),
    supabase.from('series').select('id, nome, serie_tags(tag_id)').order('nome'),
    supabase.from('tags').select('id, nome, tipo, cor').order('nome'),
  ])

  const capaMap = await getSignedCapaUrls(
    supabase,
    itens.map((i) => i.capa_url)
  )

  const series = (seriesData ?? []).map((s) => ({
    id: s.id,
    nome: s.nome,
    tagIds: (s.serie_tags ?? []).map((st: { tag_id: string }) => st.tag_id),
  }))

  return (
    <div className="flex flex-col gap-6">
      <ScrollRestore />
      <div>
        <h1 className="text-2xl font-semibold">Lista de desejos</h1>
        <p className="text-sm text-neutral-500">{itens.length} item(ns), por prioridade</p>
      </div>

      <ColecaoFilters series={series} tags={tagsData ?? []} mostrarEstado={false} mostrarAgrupar={false} />

      {itens.length === 0 ? (
        <p className="text-sm text-neutral-500">Nada na lista de desejos com esses filtros.</p>
      ) : (
        <div className="flex flex-col divide-y divide-neutral-800 rounded-lg border border-neutral-800">
          {itens.map((item) => {
            const capaUrl = capaMap.get(item.capa_url ?? '') ?? null
            return (
              <div key={item.id} className="flex items-center gap-3 p-3">
                <Link href={`/item/${item.id}`} className="flex flex-1 items-center gap-3 overflow-hidden">
                  <div className="relative h-16 w-11 flex-shrink-0 overflow-hidden rounded bg-neutral-800 border-2 border-dashed border-neutral-600">
                    {capaUrl && (
                      <Image src={capaUrl} alt={item.titulo} fill sizes="44px" className="object-cover" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{item.titulo}</span>
                    {item.serie && (
                      <span className="truncate text-xs text-neutral-500">{item.serie.nome}</span>
                    )}
                    <span className="text-xs text-neutral-600">prioridade {item.prioridade}</span>
                  </div>
                </Link>
                <AdquirirButton itemId={item.id} titulo={item.titulo} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
