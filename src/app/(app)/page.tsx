import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listarFilaDeLeitura, listarSeriesComFuros, listarUltimosItens } from '@/lib/queries'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { ItemCard } from '@/components/itens/item-card'
import { ProgressBar } from '@/components/ui/progress-bar'
import { StatTile } from '@/components/ui/stat-tile'
import { TipoBadge } from '@/components/ui/tipo-badge'
import { ScrollRestore } from '@/components/ui/scroll-restore'

function SectionHeader({ titulo, href }: { titulo: string; href?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-heading text-[19px] font-bold text-foreground">{titulo}</h2>
      {href && (
        <Link href={href} className="flex min-h-11 items-center text-sm text-link hover:underline">
          Ver tudo
        </Link>
      )}
    </div>
  )
}

// Com um furo só mostramos QUAL volume falta (com #), com vários a quantidade —
// sem o # os dois casos se leem como quantidade ("falta 4" para o volume #4).
// Até 3 faltantes dá para listar todos.
function textoFuros(faltantes: number[]): string {
  if (faltantes.length === 1) return `falta o #${faltantes[0]}`
  if (faltantes.length <= 3) {
    const nums = faltantes.map((n) => `#${n}`)
    return `faltam ${nums.slice(0, -1).join(', ')} e ${nums[nums.length - 1]}`
  }
  return `faltam ${faltantes.length}`
}

export default async function Home() {
  const supabase = await createClient()

  const [
    { count: totalDesejos },
    { count: totalComprados },
    { count: totalLidos },
    ultimosItens,
    filaDeLeitura,
    seriesComFuros,
  ] = await Promise.all([
    supabase.from('itens').select('id', { count: 'exact', head: true }).eq('estado', 'desejo'),
    supabase.from('itens').select('id', { count: 'exact', head: true }).eq('estado', 'comprado'),
    supabase.from('itens').select('id', { count: 'exact', head: true }).eq('estado', 'lido'),
    listarUltimosItens(supabase, 8),
    listarFilaDeLeitura(supabase, 8),
    listarSeriesComFuros(supabase, 5),
  ])

  const comprados = totalComprados ?? 0
  const lidos = totalLidos ?? 0
  const naEstante = comprados + lidos
  const capaMap = urlsDeCapas([...filaDeLeitura, ...ultimosItens].map((i) => i.capa_url))
  const capa = (url: string | null) => capaMap.get(url ?? '') ?? null

  return (
    <div className="flex flex-col gap-7">
      <ScrollRestore />
      <h1 className="sr-only">Início</h1>

      <section aria-label="Resumo" className="grid grid-cols-3 gap-2.5 lg:grid-cols-4 lg:gap-4">
        <StatTile value={naEstante} label="na estante" />
        <StatTile value={lidos} label="lidos" variant="success" />
        <StatTile value={totalDesejos ?? 0} label="desejos" variant="desejo" />
        <StatTile value={seriesComFuros.length} label="séries com furos" className="hidden lg:block" />
      </section>

      <section className="flex flex-col gap-2" aria-label="Progresso de leitura">
        <div className="flex items-baseline justify-between text-sm">
          <h2 className="font-heading text-[19px] font-bold text-foreground">Progresso de leitura</h2>
          <span className="text-muted-foreground">
            {lidos} de {naEstante}
          </span>
        </div>
        <ProgressBar value={lidos} max={naEstante} label="Progresso de leitura" />
      </section>

      {filaDeLeitura.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader titulo="Na fila de leitura" href="/colecao?estado=comprado" />
          <div className="-mx-5 flex gap-3 overflow-x-auto px-5 lg:mx-0 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(132px,1fr))] lg:gap-x-[18px] lg:overflow-visible lg:px-0">
            {filaDeLeitura.map((item) => (
              <div key={item.id} className="w-28 shrink-0 lg:w-auto">
                <ItemCard item={item} capaUrl={capa(item.capa_url)} />
              </div>
            ))}
          </div>
        </section>
      )}

      {seriesComFuros.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader titulo="Furos nas séries" href="/series" />
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
            {seriesComFuros.map((serie) => (
              <li key={serie.id}>
                <Link
                  href={`/serie/${serie.id}`}
                  className="flex min-h-14 items-center justify-between gap-3 px-4 py-2"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">{serie.nome}</span>
                    <TipoBadge tipo={serie.tipo} className="w-fit" />
                  </span>
                  <span className="shrink-0 text-xs text-warning-text">{textoFuros(serie.faltantes)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionHeader titulo="Chegaram agora" href="/colecao" />
        {ultimosItens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum item adicionado ainda.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2.5 lg:grid-cols-[repeat(auto-fill,minmax(132px,1fr))] lg:gap-x-[18px]">
            {ultimosItens.map((item) => (
              <ItemCard key={item.id} item={item} capaUrl={capa(item.capa_url)} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
