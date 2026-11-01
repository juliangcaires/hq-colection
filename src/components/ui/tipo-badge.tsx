import { cn } from '@/lib/utils'

const TIPOS = {
  hq: { label: 'HQ', className: 'border-tipo-hq text-tipo-hq' },
  manga: { label: 'Mangá', className: 'border-tipo-manga text-tipo-manga' },
} as const

export function TipoBadge({ tipo, className }: { tipo: keyof typeof TIPOS; className?: string }) {
  const t = TIPOS[tipo]
  return (
    <span
      className={cn(
        'inline-block rounded border px-1.5 text-[10px] font-bold tracking-[0.06em] uppercase',
        t.className,
        className
      )}
    >
      {t.label}
    </span>
  )
}
