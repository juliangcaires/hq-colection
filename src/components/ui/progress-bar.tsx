import { cn } from '@/lib/utils'

export function ProgressBar({
  value,
  max,
  label,
  className,
}: {
  value: number
  max: number
  /** Descrição acessível, ex.: "Progresso de leitura". */
  label: string
  className?: string
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('h-2 overflow-hidden rounded bg-border', className)}
    >
      <div className="h-full rounded bg-success" style={{ width: `${pct}%` }} />
    </div>
  )
}
