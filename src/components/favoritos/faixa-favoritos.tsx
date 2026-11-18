import Image from 'next/image'
import Link from 'next/link'
import type { FavoritoSerie } from '@/lib/favoritos-series'
import { cn } from '@/lib/utils'

/**
 * Faixa de até 4 capas das séries favoritas (como os 4 filmes favoritos do Letterboxd). Sem favoritos, não renderiza
 * nada. Quatro colunas em qualquer largura: a capa encolhe no celular em vez de quebrar linha.
 */
export function FaixaFavoritos({
  favoritos,
  hrefDaSerie,
  titulo = 'Séries favoritas',
  className,
}: {
  favoritos: FavoritoSerie[]
  /** Link de cada série (somente leitura: a página da série na vitrine, ou a própria série). */
  hrefDaSerie?: (id: string) => string
  titulo?: string
  className?: string
}) {
  if (favoritos.length === 0) return null
  return (
    <section aria-label={titulo} className={cn('flex flex-col gap-2', className)}>
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{titulo}</h2>
      <ol className="grid max-w-xl grid-cols-4 gap-2 sm:gap-3">
        {favoritos.map((f) => {
          const capa = (
            <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-card ring-1 ring-white/10">
              {f.capa ? (
                <Image unoptimized src={f.capa} alt={f.nome} fill sizes="(max-width: 640px) 22vw, 140px" className="object-cover" />
              ) : (
                <div className="flex h-full flex-col justify-end p-1.5">
                  <span className="font-heading text-xs leading-[1.05] font-extrabold break-words text-foreground sm:text-sm">{f.nome}</span>
                </div>
              )}
            </div>
          )
          return (
            <li key={f.id} className="flex min-w-0 flex-col gap-1">
              {hrefDaSerie ? (
                <Link href={hrefDaSerie(f.id)} title={f.nome} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {capa}
                </Link>
              ) : (
                capa
              )}
              <p className="line-clamp-2 text-xs leading-tight font-medium text-foreground">{f.nome}</p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
