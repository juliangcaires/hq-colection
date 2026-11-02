import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listarRanking, type ItemDoRanking } from '@/lib/queries'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { lerLimiteRanking, lerTipoDaUrl, RANKING_POR_PAGINA } from '@/lib/filtros-url'
import { CarregarMais } from '@/components/itens/carregar-mais'
import { Estrelas } from '@/components/ui/estrelas'
import { formatarNota } from '@/lib/nota'
import { ScrollRestore } from '@/components/ui/scroll-restore'
import { cn } from '@/lib/utils'

type SearchParams = { tipo?: string; limite?: string }

const TIPOS = [
  { valor: undefined, label: 'Todos' },
  { valor: 'hq', label: 'HQ' },
  { valor: 'manga', label: 'Mangá' },
] as const

function Capa({ item, capaUrl, className }: { item: ItemDoRanking; capaUrl: string | null; className?: string }) {
  return (
    <div className={cn('relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-2 ring-1 ring-white/10', className)}>
      {capaUrl ? (
        <Image unoptimized src={capaUrl} alt={item.titulo} fill sizes="160px" className="object-cover" />
      ) : (
        <div className="flex h-full items-end p-1.5 font-heading text-xs leading-tight font-extrabold">{item.titulo}</div>
      )}
    </div>
  )
}

function subtitulo(item: ItemDoRanking) {
  if (!item.serie) return null
  const num = item.serie.tem_numeracao && item.numero_volume !== null ? `#${item.numero_volume} ` : ''
  return `${num}${item.serie.nome}`
}

export default async function RankingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const tipo = lerTipoDaUrl(params.tipo)
  const limite = lerLimiteRanking(params.limite)

  const supabase = await createClient()
  const { itens, resumo } = await listarRanking(supabase, tipo, limite)
  const capaMap = urlsDeCapas(itens.map((i) => i.capa_url))
  const capa = (i: ItemDoRanking) => capaMap.get(i.capa_url ?? '') ?? null

  const podio = itens.slice(0, 3)
  const resto = itens.slice(3)

  return (
    <div className="flex flex-col gap-6">
      <ScrollRestore />
      <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Ranking</h1>

      <div role="group" aria-label="Tipo" className="flex w-full max-w-64 gap-1 rounded-xl border border-border bg-card p-1">
        {TIPOS.map((t) => {
          const ativo = tipo === t.valor
          return (
            <Link
              key={t.label}
              href={t.valor ? `/ranking?tipo=${t.valor}` : '/ranking'}
              aria-current={ativo ? 'true' : undefined}
              className={cn(
                'flex h-10 flex-1 items-center justify-center rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground',
                ativo && 'bg-primary font-semibold text-primary-foreground hover:text-primary-foreground'
              )}
            >
              {t.label}
            </Link>
          )
        })}
      </div>

      <section className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-border bg-card p-4">
        <div>
          <p className="text-sm text-muted-foreground">Nota média</p>
          <p className="font-heading text-[32px] leading-tight font-extrabold text-warning-text">
            {resumo.media === null ? '—' : `★ ${formatarNota(Math.round(resumo.media * 100) / 100)}`}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{resumo.avaliados}</span>{' '}
          {resumo.avaliados === 1 ? 'lido avaliado' : 'lidos avaliados'}
          {resumo.semNota > 0 && (
            <>
              {' · '}
              <Link href="/colecao?estado=lido" className="text-link hover:underline">
                {resumo.semNota} sem nota
              </Link>
            </>
          )}
        </p>
      </section>

      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nada avaliado ainda. Marque um item como lido e dê uma nota para ele aparecer aqui.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 lg:max-w-[680px] lg:gap-5">
            {podio.map((item, i) => (
              <Link key={item.id} href={`/item/${item.id}`} className="group flex flex-col gap-2">
                <div className="relative">
                  <Capa item={item} capaUrl={capa(item)} className="group-hover:ring-primary/40" />
                  <span
                    className={cn(
                      'absolute top-1.5 left-1.5 flex size-8 items-center justify-center rounded-full font-heading text-base font-extrabold text-primary-foreground shadow-md',
                      i === 0 ? 'bg-warning' : 'bg-link'
                    )}
                    aria-label={`${i + 1}º lugar`}
                  >
                    {i + 1}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium text-foreground">{item.titulo}</span>
                  {subtitulo(item) && <span className="truncate text-xs text-muted-foreground">{subtitulo(item)}</span>}
                  <span className="flex items-center gap-1.5">
                    <Estrelas valor={item.nota} tamanho={14} className="max-lg:hidden" />
                    <span className="font-heading text-sm font-extrabold text-warning-text lg:hidden">★ {formatarNota(item.nota)}</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {resto.length > 0 && (
            <ol start={4} className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
              {resto.map((item, i) => (
                <li key={item.id}>
                  <Link href={`/item/${item.id}`} className="flex items-center gap-3 p-3 hover:bg-white/[0.03]">
                    <span className="w-7 shrink-0 text-center font-heading text-lg font-extrabold text-muted-foreground tabular-nums">
                      {i + 4}
                    </span>
                    <Capa item={item} capaUrl={capa(item)} className="w-[52px] shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">{item.titulo}</span>
                      {subtitulo(item) && <span className="truncate text-xs text-muted-foreground">{subtitulo(item)}</span>}
                      {item.critica && <span className="line-clamp-2 text-xs text-muted-foreground/90">{item.critica}</span>}
                    </div>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="font-heading text-base font-extrabold text-warning-text tabular-nums">★ {formatarNota(item.nota)}</span>
                      <Estrelas valor={item.nota} tamanho={12} className="max-sm:hidden" />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}

          <CarregarMais
            params={params}
            limite={limite}
            mostrando={itens.length}
            total={resumo.avaliados}
            passo={RANKING_POR_PAGINA}
          />
        </>
      )}
    </div>
  )
}
