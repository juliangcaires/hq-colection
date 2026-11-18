'use client'

import { useId, useState } from 'react'
import { ChevronDown, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Crítica de outra pessoa. Sem spoiler, é só o texto. Com spoiler, vira um cartão recolhido ("Contém spoiler · mostrar")
 * que o leitor abre se quiser (botão de verdade: teclado, `aria-expanded`, `aria-controls`). Texto sempre como texto puro.
 *
 * `proprio`: a crítica é de quem está vendo. Aparece normal, só com o selo "spoiler" ao lado, para ela saber como
 * os outros a veem.
 */
export function CriticaSpoiler({
  texto,
  spoiler,
  proprio = false,
  className,
  textoClassName = 'text-sm',
}: {
  texto: string
  spoiler: boolean
  proprio?: boolean
  className?: string
  textoClassName?: string
}) {
  const [aberta, setAberta] = useState(false)
  const idTexto = useId()
  const corpo = cn('break-words whitespace-pre-wrap text-foreground/90', textoClassName)

  if (!spoiler) return <p className={cn(corpo, className)}>{texto}</p>

  if (proprio) {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <SeloSpoiler />
        <p className={corpo}>{texto}</p>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <button
        type="button"
        aria-expanded={aberta}
        aria-controls={idTexto}
        onClick={() => setAberta((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-dashed border-border bg-surface-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-white/[0.04] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <TriangleAlert className="size-4 shrink-0 text-warning-text" aria-hidden />
        <span className="min-w-0 flex-1">Contém spoiler · {aberta ? 'ocultar' : 'mostrar'}</span>
        <ChevronDown className={cn('size-4 shrink-0 transition-transform', aberta && 'rotate-180')} aria-hidden />
      </button>
      {aberta && (
        <p id={idTexto} className={corpo}>
          {texto}
        </p>
      )}
    </div>
  )
}

/** Selo "spoiler" que o dono vê ao lado da própria crítica marcada. */
export function SeloSpoiler({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex w-fit items-center gap-1 rounded-4xl bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-text', className)}>
      <TriangleAlert className="size-3" aria-hidden />
      spoiler
    </span>
  )
}
