import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function FilterChip({
  label,
  valor,
  variant = 'default',
  onClick,
  onClear,
  className,
}: {
  label: string
  /** Valor selecionado; quando presente o chip fica ativo e mostra o X. */
  valor?: string | null
  variant?: 'default' | 'furos'
  onClick?: () => void
  onClear?: () => void
  className?: string
}) {
  const ativo = Boolean(valor)
  return (
    <span
      className={cn(
        'inline-flex h-11 shrink-0 items-center rounded-full border text-sm whitespace-nowrap',
        variant === 'furos'
          ? 'border-dashed border-warning text-warning-text'
          : ativo
            ? 'border-primary bg-primary/15 text-foreground'
            : 'border-border bg-card text-foreground',
        className
      )}
    >
      <button
        type="button"
        aria-pressed={ativo}
        onClick={onClick}
        className={cn('h-full rounded-full pl-3.5', ativo && onClear ? 'pr-1' : 'pr-3.5')}
      >
        {label}
        {valor && <span className="text-link">: {valor}</span>}
      </button>
      {ativo && onClear && (
        <button
          type="button"
          aria-label={`Limpar filtro ${label}`}
          onClick={onClear}
          className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </span>
  )
}
