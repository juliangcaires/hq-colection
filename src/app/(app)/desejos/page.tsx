import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listarItensPagina } from '@/lib/queries'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { ColecaoFilters } from '@/components/itens/colecao-filters'
import { DesejosLista } from '@/components/itens/desejos-lista'
import { ScrollRestore } from '@/components/ui/scroll-restore'
import { lerFiltrosDaUrl, lerLimite } from '@/lib/filtros-url'
import { CarregarMais } from '@/components/itens/carregar-mais'

type SearchParams = {
  ordem?: string
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
  const ordem = params.ordem === 'preco' ? 'preco' : 'prioridade'

  const [{ itens, total }, { data: seriesData }, { data: tagsData }, { data: resumoData }] = await Promise.all([
    listarItensPagina(
      supabase,
      { ...lerFiltrosDaUrl(params), estado: 'desejo' },
      { column: ordem, ascending: false },
      limite
    ),
    supabase.from('series').select('id, nome, serie_tags(tag_id)').order('nome'),
    supabase.from('tags').select('id, nome, tipo, cor').order('nome'),
    supabase.from('itens').select('preco, prioridade').eq('estado', 'desejo'),
  ])

  const capaMap = urlsDeCapas(itens.map((i) => i.capa_url)
  )

  const series = (seriesData ?? []).map((s) => ({
    id: s.id,
    nome: s.nome,
    tagIds: (s.serie_tags ?? []).map((st: { tag_id: string }) => st.tag_id),
  }))

  const desejos = resumoData ?? []
  const somaPrecos = desejos.reduce((acc, d) => acc + (d.preco ?? 0), 0)
  const altaPrioridade = desejos.filter((d) => (d.prioridade ?? 0) > 0).length
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

  function linkOrdem(valor: 'prioridade' | 'preco') {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => typeof v === 'string' && v) as [string, string][])
    q.delete('limite')
    if (valor === 'prioridade') q.delete('ordem')
    else q.set('ordem', valor)
    const qs = q.toString()
    return qs ? `/desejos?${qs}` : '/desejos'
  }

  return (
    <div className="flex flex-col gap-6">
      <ScrollRestore />
      <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Desejos</h1>

      <section className="rounded-xl border border-dashed border-warning bg-warning/[0.08] p-4">
        <p className="text-sm text-muted-foreground">Para completar a lista</p>
        <p className="font-heading text-[32px] leading-tight font-extrabold text-warning-text">
          {brl.format(somaPrecos)}
        </p>
        <p className="text-sm text-muted-foreground">
          {desejos.length} {desejos.length === 1 ? 'item' : 'itens'} · {altaPrioridade} com prioridade
        </p>
      </section>

      <div className="flex items-center gap-2" role="group" aria-label="Ordenar">
        <span className="text-sm text-muted-foreground">Ordenar:</span>
        {(['prioridade', 'preco'] as const).map((o) => (
          <Link
            key={o}
            href={linkOrdem(o)}
            aria-current={ordem === o ? 'true' : undefined}
            className={`flex h-11 items-center rounded-full border px-3.5 text-sm ${
              ordem === o ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card text-muted-foreground'
            }`}
          >
            {o === 'prioridade' ? 'Prioridade' : 'Preço'}
          </Link>
        ))}
      </div>

      <ColecaoFilters series={series} tags={tagsData ?? []} mostrarEstado={false} mostrarAgrupar={false} />

      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada na lista de desejos com esses filtros.</p>
      ) : (
        <>
          <DesejosLista itens={itens} capas={Array.from(capaMap.entries())} />
          <CarregarMais params={params} limite={limite} mostrando={itens.length} total={total} />
        </>
      )}
    </div>
  )
}
