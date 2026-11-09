import Image from 'next/image'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Estrelas } from '@/components/ui/estrelas'
import { formatarNota } from '@/lib/nota'
import { baseDaFonte, rotuloDeVolume, urlDeCapaDaVitrine, type FonteVitrine, type ItemVitrine, type SerieVitrine } from '@/lib/vitrine'
import { SerieProgress } from '@/components/series/serie-progress'
import { cn } from '@/lib/utils'

/** Grade de capas de uma coleção alheia (somente leitura). */
export function GradeDaVitrine({
  itens,
  fonte,
  acao,
}: {
  itens: ItemVitrine[]
  fonte: FonteVitrine
  /** Ação por item (ex.: "Vou dar esse" na lista de desejos de um amigo). */
  acao?: (item: ItemVitrine) => React.ReactNode
}) {
  if (itens.length === 0) {
    return <p className="text-sm text-muted-foreground">Nada por aqui ainda.</p>
  }
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
      {itens.map((item) => {
        const capa = urlDeCapaDaVitrine(fonte, item.capa)
        const sub = [item.serie_nome, rotuloDeVolume(item.numero_volume)].filter(Boolean).join(' ')
        return (
          <li key={item.id} className="flex flex-col gap-1.5">
            <div className={cn('relative aspect-[2/3] overflow-hidden rounded-lg bg-card ring-1 ring-white/10', item.estado === 'desejo' && 'border-2 border-dashed border-warning')}>
              {capa ? (
                <Image unoptimized src={capa} alt={item.titulo} fill sizes="(max-width: 640px) 45vw, 160px" className="object-cover" />
              ) : (
                <div className="flex h-full flex-col justify-end p-2">
                  <span className="font-heading text-sm leading-[1.05] font-extrabold text-foreground">{item.titulo}</span>
                </div>
              )}
              {item.estado === 'lido' && <Badge className="absolute top-1.5 left-1.5 bg-read text-primary-foreground">Lido</Badge>}
            </div>
            <p className="line-clamp-2 text-sm leading-tight font-medium text-foreground">{item.titulo}</p>
            {sub && sub !== item.titulo && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
            {item.nota !== null && (
              <p className="flex items-center gap-1.5 text-xs text-warning-text">
                <Estrelas valor={item.nota} tamanho={14} mostrarValor={false} />
                <span className="font-semibold tabular-nums">{formatarNota(item.nota)}</span>
              </p>
            )}
            {item.lido_em && <p className="text-xs text-muted-foreground">Lido em {item.lido_em.split('-').reverse().join('/')}</p>}
            {item.critica && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer text-link">Crítica</summary>
                <p className="mt-1 whitespace-pre-line">{item.critica}</p>
              </details>
            )}
            {acao?.(item)}
          </li>
        )
      })}
    </ul>
  )
}

/** Lista de séries com progresso (lidos / na fila / faltando). */
export function ListaDeSeriesDaVitrine({ series, fonte }: { series: SerieVitrine[]; fonte: FonteVitrine }) {
  if (series.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma série por aqui ainda.</p>
  const base = baseDaFonte(fonte)
  return (
    <ul className="grid grid-cols-1 gap-3 lg:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
      {series.map((s) => {
        const capa = urlDeCapaDaVitrine(fonte, s.capa)
        const lidos = s.lidos ?? 0
        const naFila = s.lidos === null ? s.possuidos : Math.max(s.possuidos - lidos, 0)
        const faltando = s.total_volumes ? Math.max(s.total_volumes - s.possuidos, 0) : 0
        return (
          <li key={s.id}>
            <Link href={`${base}/serie/${s.id}`} className="flex gap-3 rounded-xl border border-border bg-card p-3">
              <div className="relative aspect-[2/3] w-14 shrink-0 overflow-hidden rounded bg-surface-2 ring-1 ring-white/10">
                {capa && <Image unoptimized src={capa} alt="" fill sizes="56px" className="object-cover" />}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="truncate text-sm font-semibold text-foreground">{s.nome}</span>
                <span className="text-xs text-muted-foreground">
                  {s.possuidos} {s.possuidos === 1 ? 'volume' : 'volumes'}
                  {s.total_volumes ? ` de ${s.total_volumes}` : ''}
                  {s.lidos !== null ? ` · ${s.lidos} ${s.lidos === 1 ? 'lido' : 'lidos'}` : ''}
                  {s.nota !== null ? ` · ★ ${formatarNota(s.nota)}` : ''}
                </span>
                {s.lidos !== null && <SerieProgress lidos={lidos} naFila={naFila} faltando={faltando} />}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
