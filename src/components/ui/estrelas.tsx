'use client'

import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

const TOTAL = 5

/** Formata a nota no padrão brasileiro: 4,5 / 3. */
export function formatarNota(nota: number) {
  return nota.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

function Preenchimento({ fracao, className }: { fracao: 0 | 0.5 | 1; className?: string }) {
  return (
    <span className={cn('relative inline-block', className)}>
      <Star className="text-muted-foreground/50" style={{ width: 'var(--tam)', height: 'var(--tam)' }} />
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fracao * 100}%` }}>
        <Star className="fill-warning text-warning" style={{ width: 'var(--tam)', height: 'var(--tam)', maxWidth: 'none' }} />
      </span>
    </span>
  )
}

/**
 * Cinco estrelas com meia estrela: o clique na metade esquerda de uma estrela dá x,5; na direita, x.
 * Clicar na nota que já está marcada limpa. Também funciona por teclado (setas, Home/End).
 * Sem `onChange`, só mostra a nota.
 */
export function Estrelas({
  valor,
  onChange,
  tamanho = 32,
  className,
}: {
  valor: number | null
  onChange?: (nota: number | null) => void
  /** Lado de cada estrela em px. */
  tamanho?: number
  className?: string
}) {
  const nota = valor ?? 0
  const editavel = Boolean(onChange)

  const estrelas = Array.from({ length: TOTAL }, (_, i) => {
    const fracao = nota >= i + 1 ? 1 : nota >= i + 0.5 ? 0.5 : 0
    return (
      <Preenchimento
        key={i}
        fracao={fracao as 0 | 0.5 | 1}
        className="shrink-0"
      />
    )
  })

  if (!editavel) {
    return (
      <span
        role="img"
        aria-label={valor === null ? 'Sem nota' : `Nota ${formatarNota(valor)} de 5`}
        className={cn('inline-flex items-center', className)}
        style={{ ['--tam' as string]: `${tamanho}px`, height: tamanho }}
      >
        {estrelas.map((el, i) => (
          <span key={i} style={{ width: tamanho, height: tamanho }} className="inline-block">
            {el}
          </span>
        ))}
      </span>
    )
  }

  function daPosicao(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width)
    const meias = Math.max(1, Math.ceil((x / r.width) * TOTAL * 2))
    return meias / 2
  }

  function definir(n: number) {
    onChange?.(n === valor ? null : n)
  }

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Nota"
        aria-valuemin={0}
        aria-valuemax={TOTAL}
        aria-valuenow={nota}
        aria-valuetext={valor === null ? 'Sem nota' : `${formatarNota(valor)} de 5`}
        onClick={(e) => definir(daPosicao(e))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault()
            onChange?.(Math.min(TOTAL, nota + 0.5))
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault()
            onChange?.(nota - 0.5 >= 0.5 ? nota - 0.5 : null)
          } else if (e.key === 'Home' || e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            onChange?.(null)
          } else if (e.key === 'End') {
            e.preventDefault()
            onChange?.(TOTAL)
          }
        }}
        className="inline-flex cursor-pointer touch-manipulation items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ ['--tam' as string]: `${tamanho}px`, height: Math.max(tamanho, 44) }}
      >
        {estrelas.map((el, i) => (
          <span key={i} style={{ width: tamanho, height: tamanho }} className="inline-block">
            {el}
          </span>
        ))}
      </div>
      <span className="min-w-8 text-sm text-muted-foreground tabular-nums">
        {valor === null ? '—' : formatarNota(valor)}
      </span>
    </div>
  )
}
