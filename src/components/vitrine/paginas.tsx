import Image from 'next/image'
import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Estrelas } from '@/components/ui/estrelas'
import { GradeDaVitrine, ListaDeSeriesDaVitrine } from '@/components/vitrine/grade-da-vitrine'
import { VerMais } from '@/components/vitrine/ver-mais'
import { SerieProgress } from '@/components/series/serie-progress'
import { formatarNota } from '@/lib/nota'
import type { SecaoCompartilhavel } from '@/lib/compartilhamento'
import {
  baseDaFonte,
  carregarItens,
  carregarSeries,
  rotuloDeVolume,
  urlDeCapaDaVitrine,
  type FonteVitrine,
  type ItemVitrine,
  type ResumoVitrine,
  type SecaoVitrine,
} from '@/lib/vitrine'
import { ITENS_POR_PAGINA } from '@/lib/filtros-url'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

type Base = {
  supabase: Cliente
  fonte: FonteVitrine
  resumo: ResumoVitrine
  /** Itens a mostrar (`?limite=`). */
  limite?: number
  /** Ação extra por item (lista de desejos de amigo). */
  acaoItem?: (item: ItemVitrine) => React.ReactNode
}

function Indisponivel() {
  return <p className="text-sm text-muted-foreground">Esta seção não está sendo compartilhada.</p>
}

function Titulo({ children, total }: { children: React.ReactNode; total?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="font-heading text-xl font-bold text-foreground">{children}</h2>
      {total !== undefined && <span className="text-sm text-muted-foreground tabular-nums">{total}</span>}
    </div>
  )
}

const POR_SECAO: Record<'colecao' | 'lidos' | 'desejos', { titulo: string; requer: SecaoCompartilhavel; sufixo: string }> = {
  colecao: { titulo: 'Coleção', requer: 'colecao', sufixo: '' },
  lidos: { titulo: 'Lidos', requer: 'lidos', sufixo: '/lidos' },
  desejos: { titulo: 'Lista de desejos', requer: 'desejos', sufixo: '/desejos' },
}

async function PaginaDeGrade({ secao, supabase, fonte, resumo, limite = ITENS_POR_PAGINA, acaoItem }: Base & { secao: 'colecao' | 'lidos' | 'desejos' }) {
  const cfg = POR_SECAO[secao]
  if (!resumo.escopo.includes(cfg.requer)) return <Indisponivel />
  const { itens, total } = await carregarItens(supabase, fonte, secao as SecaoVitrine, { limite })
  return (
    <section className="flex flex-col gap-4">
      <Titulo total={total}>{cfg.titulo}</Titulo>
      <GradeDaVitrine itens={itens} fonte={fonte} acao={acaoItem} />
      <VerMais href={`${baseDaFonte(fonte)}${cfg.sufixo}`} mostrados={itens.length} total={total} limite={limite} />
    </section>
  )
}

export const PaginaColecao = (p: Base) => PaginaDeGrade({ ...p, secao: 'colecao' })
export const PaginaLidos = (p: Base) => PaginaDeGrade({ ...p, secao: 'lidos' })
export const PaginaDesejos = (p: Base) => PaginaDeGrade({ ...p, secao: 'desejos' })

export async function PaginaSeries({ supabase, fonte, resumo }: Base) {
  if (!resumo.escopo.includes('series')) return <Indisponivel />
  const series = await carregarSeries(supabase, fonte)
  return (
    <section className="flex flex-col gap-4">
      <Titulo total={series.length}>Séries</Titulo>
      <ListaDeSeriesDaVitrine series={series} fonte={fonte} />
    </section>
  )
}

export async function PaginaSerie({ supabase, fonte, resumo, serieId, acaoItem }: Base & { serieId: string }) {
  if (!resumo.escopo.includes('series')) return <Indisponivel />
  const [[serie], { itens }] = await Promise.all([
    carregarSeries(supabase, fonte, serieId),
    carregarItens(supabase, fonte, 'serie', { serie: serieId, limite: 200 }),
  ])
  if (!serie) return null
  const base = baseDaFonte(fonte)
  const lidos = serie.lidos ?? 0
  const naFila = serie.lidos === null ? serie.possuidos : Math.max(serie.possuidos - lidos, 0)
  const faltando = serie.total_volumes ? Math.max(serie.total_volumes - serie.possuidos, 0) : 0
  return (
    <section className="flex flex-col gap-4">
      <Link href={`${base}/series`} className="w-fit text-sm text-muted-foreground hover:text-foreground">
        ← Séries
      </Link>
      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-[26px] leading-tight font-extrabold tracking-tight text-foreground">{serie.nome}</h2>
        <p className="text-sm text-muted-foreground">
          {serie.possuidos} {serie.possuidos === 1 ? 'volume' : 'volumes'}
          {serie.total_volumes ? ` de ${serie.total_volumes}` : ''}
          {serie.nota !== null ? ` · nota da série ★ ${formatarNota(serie.nota)}` : ''}
        </p>
        {serie.lidos !== null && <SerieProgress lidos={lidos} naFila={naFila} faltando={faltando} />}
        {serie.critica && <p className="rounded-xl border border-border bg-card p-3 text-sm whitespace-pre-line text-muted-foreground">{serie.critica}</p>}
      </div>
      <GradeDaVitrine itens={itens} fonte={fonte} acao={acaoItem} />
    </section>
  )
}

export async function PaginaRanking({ supabase, fonte, resumo, limite = 25 }: Base) {
  if (!resumo.escopo.includes('ranking')) return <Indisponivel />
  const { itens, total } = await carregarItens(supabase, fonte, 'ranking', { limite })
  return (
    <section className="flex flex-col gap-4">
      <Titulo total={total}>Ranking</Titulo>
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada avaliado ainda.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {itens.map((item, i) => {
            const capa = urlDeCapaDaVitrine(fonte, item.capa)
            const sub = [item.serie_nome, rotuloDeVolume(item.numero_volume)].filter(Boolean).join(' ')
            return (
              <li key={item.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <span className="w-7 shrink-0 text-center font-heading text-lg font-extrabold text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="relative aspect-[2/3] w-11 shrink-0 overflow-hidden rounded bg-surface-2 ring-1 ring-white/10">
                  {capa && <Image unoptimized src={capa} alt="" fill sizes="44px" className="object-cover" />}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold text-foreground">{item.titulo}</span>
                  {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
                  {item.critica && <span className="line-clamp-2 text-xs text-muted-foreground">{item.critica}</span>}
                </div>
                {item.nota !== null && (
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <Estrelas valor={item.nota} tamanho={14} mostrarValor={false} />
                    <span className="font-heading text-lg font-extrabold text-warning-text tabular-nums">{formatarNota(item.nota)}</span>
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
      <VerMais href={`${baseDaFonte(fonte)}/ranking`} mostrados={itens.length} total={total} limite={limite} />
    </section>
  )
}
