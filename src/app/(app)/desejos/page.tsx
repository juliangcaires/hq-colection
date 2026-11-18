import { createClient } from '@/lib/supabase/server'
import { listarItensPagina } from '@/lib/queries'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { DesejosLista } from '@/components/itens/desejos-lista'
import { ScrollRestore } from '@/components/ui/scroll-restore'
import { lerAgruparPorSerie, lerFiltrosDaUrl, lerLimite } from '@/lib/filtros-url'
import { CarregarMais } from '@/components/itens/carregar-mais'
import { agruparDesejosPorSerie, lerOrdemDesejos, ordenarDesejos, type OrdemDesejos } from '@/lib/desejos-agrupados'

type SearchParams = {
  ordem?: string
  agrupar?: string
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

/** Teto de desejos buscados de uma vez: os filtros, a contagem e o agrupamento precisam do recorte inteiro. */
const TETO_DESEJOS = 1000

/** Coluna do banco por onde cada ordem começa; o que o banco não resolve (preço sem valor, série) fica em `ordenarDesejos`. */
const COLUNA_DA_ORDEM: Record<OrdemDesejos, string> = {
  prioridade: 'prioridade',
  preco: 'preco',
  recentes: 'created_at',
  serie: 'created_at',
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function DesejosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const limite = lerLimite(params.limite)
  const ordem = lerOrdemDesejos(params.ordem)
  const agrupar = lerAgruparPorSerie(params.agrupar)
  const filtros = lerFiltrosDaUrl(params)

  const [{ itens: recorte, total }, { data: seriesData }, { data: tagsData }] = await Promise.all([
    listarItensPagina(
      supabase,
      { ...filtros, estado: 'desejo' },
      { column: COLUNA_DA_ORDEM[ordem], ascending: false },
      TETO_DESEJOS
    ),
    supabase.from('series').select('id, nome, serie_tags(tag_id)').order('nome'),
    supabase.from('tags').select('id, nome, tipo, cor').order('nome'),
  ])

  const todos = ordenarDesejos(recorte, ordem)
  const grupos = agrupar ? agruparDesejosPorSerie(todos) : null
  // Na grade a lista continua paginada ("Carregar mais"); no modo agrupado vão todos.
  const visiveis = agrupar ? todos : todos.slice(0, limite)

  const capaMap = urlsDeCapas(visiveis.map((i) => i.capa_url))

  const series = (seriesData ?? []).map((s) => ({
    id: s.id,
    nome: s.nome,
    tagIds: (s.serie_tags ?? []).map((st: { tag_id: string }) => st.tag_id),
  }))

  // As pílulas falam do recorte filtrado, o mesmo que as duas visões mostram.
  const somaPrecos = todos.reduce((acc, d) => acc + (d.preco ?? 0), 0)
  const comPrioridade = todos.filter((d) => d.prioridade > 0).length
  const totalSeries = grupos ? grupos.filter((g) => g.serieId).length : 0
  const temFiltros = Boolean(
    filtros.busca ||
      filtros.tipo ||
      filtros.serieId ||
      filtros.semCapa ||
      Object.keys(filtros.tagsPorTipo ?? {}).length > 0
  )

  return (
    <div className="flex flex-col gap-4">
      <ScrollRestore />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <h1 className="font-heading text-[32px] font-extrabold tracking-tight text-foreground">Desejos</h1>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-warning px-3 text-warning-text">
            <strong className="font-heading">{total}</strong> {total === 1 ? 'item' : 'itens'}
            {agrupar && totalSeries > 0 && (
              <>
                {' '}em <strong className="font-heading">{totalSeries}</strong> {totalSeries === 1 ? 'série' : 'séries'}
              </>
            )}
          </span>
          <span className="inline-flex h-8 items-center rounded-full border border-border px-3 text-muted-foreground">
            Total {brl.format(somaPrecos)}
          </span>
          {comPrioridade > 0 && (
            <span className="inline-flex h-8 items-center rounded-full border border-border px-3 text-muted-foreground">
              {comPrioridade} com prioridade
            </span>
          )}
        </div>
      </div>

      <DesejosLista
        itens={visiveis}
        grupos={grupos}
        capas={Array.from(capaMap.entries())}
        series={series}
        tags={tagsData ?? []}
        ordem={ordem}
        agrupar={agrupar}
        temFiltros={temFiltros}
      />

      {!agrupar && <CarregarMais params={params} limite={limite} mostrando={visiveis.length} total={total} />}
    </div>
  )
}
