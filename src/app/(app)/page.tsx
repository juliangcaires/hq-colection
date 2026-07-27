import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listarSeriesComFuros, listarUltimosItens } from '@/lib/queries'

const TIPO_LABEL: Record<'hq' | 'manga', string> = { hq: 'HQ', manga: 'Mangá' }

export default async function Home() {
  const supabase = await createClient()

  const [
    { count: totalDesejos },
    { count: totalComprados },
    { count: totalLidos },
    { count: totalSeries },
    ultimosItens,
    seriesComFuros,
  ] = await Promise.all([
    supabase.from('itens').select('id', { count: 'exact', head: true }).eq('estado', 'desejo'),
    supabase.from('itens').select('id', { count: 'exact', head: true }).eq('estado', 'comprado'),
    supabase.from('itens').select('id', { count: 'exact', head: true }).eq('estado', 'lido'),
    supabase.from('series').select('id', { count: 'exact', head: true }),
    listarUltimosItens(supabase, 5),
    listarSeriesComFuros(supabase, 5),
  ])

  const cards = [
    { label: 'Na coleção', value: (totalComprados ?? 0) + (totalLidos ?? 0), href: '/colecao' },
    { label: 'Na lista de desejos', value: totalDesejos ?? 0, href: '/desejos' },
    { label: 'Séries cadastradas', value: totalSeries ?? 0, href: '/colecao' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">Início</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <p className="font-heading text-3xl font-semibold text-foreground">{card.value}</p>
            <p className="text-sm text-muted-foreground">{card.label}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <h2 className="font-heading text-sm font-semibold text-foreground/90">Adicionados recentemente</h2>
          {ultimosItens.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum item adicionado ainda.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {ultimosItens.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/item/${item.id}`}
                    className="flex items-center justify-between gap-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className="truncate">
                      <span className="text-foreground">{item.titulo}</span>
                      {item.serie && <span className="text-muted-foreground"> · {item.serie.nome}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <h2 className="font-heading text-sm font-semibold text-foreground/90">O que comprar a seguir</h2>
          {seriesComFuros.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma série com furos identificados (ou faltam volumes/total cadastrados).
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {seriesComFuros.map((serie) => (
                <li key={serie.id}>
                  <Link
                    href={`/serie/${serie.id}`}
                    className="flex items-center justify-between gap-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className="truncate">
                      <span className="text-foreground">{serie.nome}</span>
                      <span className="text-muted-foreground"> · {TIPO_LABEL[serie.tipo]}</span>
                    </span>
                    <span className="shrink-0 text-xs text-chart-3">
                      {/* Com um furo só mostramos QUAL volume falta (com #), com vários a quantidade —
                          sem o # os dois casos se leem como quantidade ("falta 4" para o volume #4). */}
                      {serie.faltantes.length === 1
                        ? `falta o #${serie.faltantes[0]}`
                        : `faltam ${serie.faltantes.length}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Use o botão + para adicionar um item, ou navegue por Coleção / Desejos / Tags.
      </p>
    </div>
  )
}
