import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listarItens } from '@/lib/queries'
import { getSignedCapaUrls } from '@/lib/supabase/capas'
import { ColecaoFilters } from '@/components/itens/colecao-filters'
import { ItemCard } from '@/components/itens/item-card'
import { ScrollRestore } from '@/components/itens/scroll-restore'
import { parseTagsPorTipoDaUrl } from '@/lib/tags-por-tipo'
import type { EstadoItem, TipoObra } from '@/lib/types'

type SearchParams = {
  busca?: string
  estado?: string
  tipo?: string
  serie?: string
  agrupar?: string
  capa?: string
  editora?: string
  personagem?: string
  arco?: string
  selo?: string
  autor?: string
  universo?: string
  outro?: string
}

export default async function ColecaoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const [itens, { data: seriesData }, { data: tagsData }] = await Promise.all([
    listarItens(supabase, {
      estado: (params.estado as EstadoItem) || undefined,
      tipo: (params.tipo as TipoObra) || undefined,
      serieId: params.serie || undefined,
      busca: params.busca || undefined,
      semCapa: params.capa === 'sem',
      tagsPorTipo: parseTagsPorTipoDaUrl(params),
    }),
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

  const agrupar = params.agrupar === '1'

  return (
    <div className="flex flex-col gap-6">
      <ScrollRestore />
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">Coleção</h1>
        <p className="text-sm text-muted-foreground">{itens.length} item(ns)</p>
      </div>

      <ColecaoFilters series={series} tags={tagsData ?? []} />

      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum item encontrado com esses filtros.</p>
      ) : agrupar ? (
        <ColecaoAgrupada itens={itens} capaMap={capaMap} />
      ) : (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {itens.map((item) => (
            <ItemCard key={item.id} item={item} capaUrl={capaMap.get(item.capa_url ?? '') ?? null} />
          ))}
        </div>
      )}
    </div>
  )
}

function ColecaoAgrupada({
  itens,
  capaMap,
}: {
  itens: Awaited<ReturnType<typeof listarItens>>
  capaMap: Map<string, string>
}) {
  const grupos = new Map<string, { nome: string; serieId: string | null; itens: typeof itens }>()
  for (const item of itens) {
    const chave = item.serie?.id ?? '__avulsos__'
    const nome = item.serie?.nome ?? 'Avulsos'
    if (!grupos.has(chave)) grupos.set(chave, { nome, serieId: item.serie?.id ?? null, itens: [] })
    grupos.get(chave)!.itens.push(item)
  }

  return (
    <div className="flex flex-col gap-8">
      {Array.from(grupos.values()).map((grupo) => (
        <div key={grupo.nome} className="flex flex-col gap-3">
          <h2 className="font-heading text-sm font-semibold text-foreground/90">
            {grupo.serieId ? (
              <Link href={`/serie/${grupo.serieId}`} className="hover:text-primary hover:underline">
                {grupo.nome}
              </Link>
            ) : (
              grupo.nome
            )}
          </h2>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {grupo.itens.map((item) => (
              <ItemCard key={item.id} item={item} capaUrl={capaMap.get(item.capa_url ?? '') ?? null} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
