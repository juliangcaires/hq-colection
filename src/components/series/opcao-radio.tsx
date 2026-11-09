'use client'

import { cn } from '@/lib/utils'

/** Opção de um grupo `role="radiogroup"`: cartão com título e explicação (modais de avaliação da série). */
export function OpcaoRadio({
  marcada,
  onSelect,
  titulo,
  texto,
  disabled,
  alerta,
}: {
  marcada: boolean
  onSelect: () => void
  titulo: string
  texto: string
  disabled?: boolean
  /** Opção destrutiva (sobrescreve dados): borda e texto em tom de alerta. */
  alerta?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcada}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-0.5 rounded-lg border p-3 text-left disabled:opacity-50',
        marcada ? (alerta ? 'border-warning bg-warning/10' : 'border-primary bg-primary/10') : 'border-border bg-surface-2',
      )}
    >
      <span className="text-sm font-medium text-foreground">{titulo}</span>
      <span className={cn('text-xs', alerta && marcada ? 'text-warning-text' : 'text-muted-foreground')}>{texto}</span>
    </button>
  )
}
