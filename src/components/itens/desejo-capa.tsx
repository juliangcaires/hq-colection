import Image from 'next/image'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Capa de um desejo: borda tracejada âmbar (todos aqui são desejos, então sem opacidade reduzida),
 * selo "Prio N" só com prioridade > 0, e o título no lugar da imagem quando não há capa.
 * No modo seleção ganha o anel violeta e o check.
 */
export function DesejoCapa({
  titulo,
  capaUrl,
  prioridade,
  numero,
  marcado = false,
  compacta = false,
  sizes,
}: {
  titulo: string
  capaUrl: string | null
  prioridade: number
  /** Número do volume, no canto inferior esquerdo (só séries numeradas). */
  numero?: number | null
  marcado?: boolean
  /** Capa pequena (96px, no modo agrupado): raio e tipografia menores. */
  compacta?: boolean
  sizes: string
}) {
  return (
    <div
      className={cn(
        'relative aspect-[2/3] overflow-hidden border-2 border-dashed border-warning bg-surface-2 transition-shadow',
        compacta ? 'rounded-md' : 'rounded-lg',
        marcado && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
      )}
    >
      {capaUrl ? (
        <Image unoptimized src={capaUrl} alt={titulo} fill sizes={sizes} className="object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col justify-end p-2 text-left">
          <span
            className={cn(
              'line-clamp-4 font-heading leading-[1.05] font-extrabold text-foreground/80',
              compacta ? 'text-xs' : 'text-sm'
            )}
          >
            {titulo}
          </span>
        </div>
      )}
      {prioridade > 0 && (
        <span className="absolute top-1.5 left-1.5 rounded-[4px] bg-warning px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase text-primary-foreground">
          Prio {prioridade}
        </span>
      )}
      {numero !== null && numero !== undefined && (
        <span className="absolute bottom-1.5 left-1.5 rounded-[3px] bg-background/75 px-1.5 font-heading text-sm font-extrabold text-foreground">
          #{numero}
        </span>
      )}
      {marcado && (
        <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        </span>
      )}
    </div>
  )
}
