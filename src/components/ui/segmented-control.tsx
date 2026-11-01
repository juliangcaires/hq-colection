import { cn } from '@/lib/utils'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  /** Classes do botão ativo; padrão é foreground sobre background. Texto sempre escuro. */
  activeClassName?: string
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex gap-1 rounded-xl border border-border bg-card p-1', className)}
    >
      {options.map((opt) => {
        const ativo = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={ativo}
            onClick={() => onChange(opt.value)}
            className={cn(
              'h-10 flex-1 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground',
              ativo && (opt.activeClassName ?? 'bg-foreground font-semibold text-background hover:text-background')
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
