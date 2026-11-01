import { cn } from '@/lib/utils'

/** Barra segmentada: lidos (verde), na fila/comprados (violeta) e faltando (contorno tracejado âmbar). */
export function SerieProgress({
  lidos,
  naFila,
  faltando,
  className,
}: {
  lidos: number
  naFila: number
  faltando: number
  className?: string
}) {
  const total = lidos + naFila + faltando
  if (total === 0) return null
  const seg = (n: number) => ({ flexGrow: n, flexBasis: 0 })

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        role="img"
        aria-label={`${lidos} lidos, ${naFila} na fila, ${faltando} faltando`}
        className="flex h-2.5 gap-0.5"
      >
        {lidos > 0 && <span style={seg(lidos)} className="rounded-sm bg-success" />}
        {naFila > 0 && <span style={seg(naFila)} className="rounded-sm bg-primary" />}
        {faltando > 0 && <span style={seg(faltando)} className="rounded-sm border border-dashed border-warning" />}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-success" />
          {lidos} lidos
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-primary" />
          {naFila} na fila
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full border border-dashed border-warning" />
          {faltando} faltando
        </li>
      </ul>
    </div>
  )
}
