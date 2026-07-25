import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import { listarItens } from '@/lib/queries'
import { getSignedCapaUrls } from '@/lib/supabase/capas'
import { ColecaoFilters } from '@/components/itens/colecao-filters'
import { AdquirirButton } from '@/components/itens/adquirir-button'
import type { TipoObra } from '@/lib/types'

type SearchParams = {
  busca?: string
  tipo?: string
  editora?: string
  serie?: string
  tag?: string
}

export default async function DesejosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const [itens, { data: seriesData }, { data: tagsData }, { data: editorasData }] = await Promise.all([
    listarItens(
      supabase,
      {
        estado: 'desejo',
        tipo: (params.tipo as TipoObra) || undefined,
        editora: params.editora || undefined,
        serieId: params.serie || undefined,
        busca: params.busca || undefined,
        tagId: params.tag || undefined,
      },
      { column: 'prioridade', ascending: false }
    ),
    supabase.from('series').select('id, nome').order('nome'),
    supabase.from('tags').select('id, nome, tipo, cor').order('nome'),
    supabase.from('series').select('editora').not('editora', 'is', null),
  ])

  const capaMap = await getSignedCapaUrls(
    supabase,
    itens.map((i) => i.capa_url)
  )

  const editoras = Array.from(
    new Set((editorasData ?? []).map((e) => e.editora as string).filter(Boolean))
  ).sort()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Lista de desejos</h1>
        <p className="text-sm text-neutral-500">{itens.length} item(ns), por prioridade</p>
      </div>

      <ColecaoFilters
        editoras={editoras}
        series={seriesData ?? []}
        tags={tagsData ?? []}
        mostrarEstado={false}
        mostrarAgrupar={false}
      />

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
