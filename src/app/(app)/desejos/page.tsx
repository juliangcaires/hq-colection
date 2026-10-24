import { createClient } from '@/lib/supabase/server'
import { listarItensPagina } from '@/lib/queries'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { ColecaoFilters } from '@/components/itens/colecao-filters'
import { DesejosLista } from '@/components/itens/desejos-lista'
import { ScrollRestore } from '@/components/ui/scroll-restore'
import { lerFiltrosDaUrl, lerLimite } from '@/lib/filtros-url'
import { CarregarMais } from '@/components/itens/carregar-mais'

type SearchParams = {
  limite?: string
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

  const limite = lerLimite(params.limite)

  const [{ itens, total }, { data: seriesData }, { data: tagsData }] = await Promise.all([
    listarItensPagina(
      supabase,
      { ...lerFiltrosDaUrl(params), estado: 'desejo' },
      { column: 'prioridade', ascending: false },
      limite
    ),
    supabase.from('series').select('id, nome, serie_tags(tag_id)').order('nome'),
    supabase.from('tags').select('id, nome, tipo, cor').order('nome'),
  ])

  const capaMap = urlsDeCapas(itens.map((i) => i.capa_url)
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
        <p className="text-sm text-neutral-500">{total} item(ns), por prioridade</p>
      </div>

      <ColecaoFilters series={series} tags={tagsData ?? []} mostrarEstado={false} mostrarAgrupar={false} />

      {itens.length === 0 ? (
        <p className="text-sm text-neutral-500">Nada na lista de desejos com esses filtros.</p>
      ) : (
        <>
          <DesejosLista itens={itens} capas={Array.from(capaMap.entries())} />
          <CarregarMais params={params} limite={limite} mostrando={itens.length} total={total} />
        </>
      )}
    </div>
  )
}
