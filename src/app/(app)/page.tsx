import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listarFilaDeLeitura, listarSeriesComFuros, listarUltimosItens } from '@/lib/queries'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { ItemCard } from '@/components/itens/item-card'
import { ProgressBar } from '@/components/ui/progress-bar'
import { StatTile } from '@/components/ui/stat-tile'
import { TipoBadge } from '@/components/ui/tipo-badge'
import { ScrollRestore } from '@/components/ui/scroll-restore'
import { FUSO_DO_APP, hojeIso } from '@/lib/datas'
import { anoCandidatoAoDestaque } from '@/lib/estatisticas'
import { cn } from '@/lib/utils'

// Faixas de capas em UMA linha, sem rolagem: 4 capas no celular, 6 no tablet (sm), 8 no desktop largo (xl).
// As que não cabem ficam ocultas; o "Ver tudo" do cabeçalho cobre o resto.
const FAIXA_UMA_LINHA = 'grid grid-cols-4 gap-2.5 sm:grid-cols-6 lg:gap-x-[18px] xl:grid-cols-8'
function classeDaPosicao(i: number): string | undefined {
  if (i >= 6) return 'hidden xl:block'
  if (i >= 4) return 'hidden sm:block'
  return undefined
}

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
  const hoje = hojeIso(FUSO_DO_APP)
  // Em dezembro (ano corrente) e janeiro (ano anterior) o início lembra, sem alarde, do "Seu ano em HQ".
  const anoDoDestaque = anoCandidatoAoDestaque(hoje)

  const [
    { count: totalDesejos },
    { count: totalComprados },
    { count: totalLidos },
    { count: lidosPrincipais },
    { count: compradosPrincipais },
    ultimosItens,
    filaDeLeitura,
    seriesComFuros,
    { count: emprestimosAtrasados },
    { count: leiturasDoAnoEmDestaque },
  ] = await Promise.all([
    supabase.from('itens').select('id', { count: 'exact', head: true }).eq('estado', 'desejo'),
    supabase.from('itens').select('id', { count: 'exact', head: true }).eq('estado', 'comprado'),
    supabase.from('itens').select('id', { count: 'exact', head: true }).eq('estado', 'lido'),
    // Variante (outra capa do mesmo volume) conta na estante, mas não em lidos nem no progresso.
    supabase.from('itens').select('id', { count: 'exact', head: true }).eq('estado', 'lido').is('variante_de', null),
    supabase.from('itens').select('id', { count: 'exact', head: true }).eq('estado', 'comprado').is('variante_de', null),
    listarUltimosItens(supabase, 8),
    listarFilaDeLeitura(supabase, 8),
    listarSeriesComFuros(supabase, 5),
    supabase.from('emprestimos').select('id', { count: 'exact', head: true }).is('devolvido_em', null).lt('devolver_ate', hoje),
    anoDoDestaque === null
      ? Promise.resolve({ count: 0 })
      : supabase.from('leituras').select('id', { count: 'exact', head: true }).gte('lido_em', `${anoDoDestaque}-01-01`).lte('lido_em', `${anoDoDestaque}-12-31`),
  ])

  const naEstante = (totalComprados ?? 0) + (totalLidos ?? 0)
  const lidos = lidosPrincipais ?? 0
  const obrasNaEstante = (compradosPrincipais ?? 0) + lidos
  const capaMap = urlsDeCapas([...filaDeLeitura, ...ultimosItens].map((i) => i.capa_url))
  const capa = (url: string | null) => capaMap.get(url ?? '') ?? null

  return (
    <div className="flex flex-col gap-7">
      <ScrollRestore />
      <h1 className="sr-only">Início</h1>

      {(emprestimosAtrasados ?? 0) > 0 && (
        <Link href="/emprestimos" className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-warning/45 bg-warning/10 px-4 py-2 text-sm text-warning-text">
          <span>
            {emprestimosAtrasados} {emprestimosAtrasados === 1 ? 'empréstimo atrasado' : 'empréstimos atrasados'}
          </span>
          <span className="shrink-0 font-medium underline underline-offset-2">Ver</span>
        </Link>
      )}

      {anoDoDestaque !== null && (leiturasDoAnoEmDestaque ?? 0) > 0 && (
        <Link href={`/estatisticas/ano?ano=${anoDoDestaque}`} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground">
          <span>Seu {anoDoDestaque} em HQ está pronto</span>
          <span className="shrink-0 font-medium text-link underline underline-offset-2">Ver</span>
        </Link>
      )}

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
            {lidos} de {obrasNaEstante}
          </span>
        </div>
        <ProgressBar value={lidos} max={obrasNaEstante} label="Progresso de leitura" />
      </section>

      {filaDeLeitura.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader titulo="Na fila de leitura" href="/colecao?estado=comprado" />
          <div className={FAIXA_UMA_LINHA}>
            {filaDeLeitura.map((item, i) => (
              <div key={item.id} className={cn('min-w-0', classeDaPosicao(i))}>
                <ItemCard item={item} capaUrl={capa(item.capa_url)} de="/" />
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
          <div className={FAIXA_UMA_LINHA}>
            {ultimosItens.map((item, i) => (
              <div key={item.id} className={cn('min-w-0', classeDaPosicao(i))}>
                <ItemCard item={item} capaUrl={capa(item.capa_url)} de="/" />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
