import { Crown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ROTULO_MELHOR } from '@/lib/melhor-da-serie'

/**
 * Selo de coroa do "melhor da série" (0030). Não depende só da cor: tem ícone e texto para leitor de tela.
 * Posiciona-se sozinho no canto da capa (o pai precisa ser `relative`); `rotulo` troca o texto (ex.: "Melhor da série para 2 amigos").
 */
export function SeloMelhor({ rotulo = ROTULO_MELHOR, className }: { rotulo?: string; className?: string }) {
  return (
    <span
      title={rotulo}
      className={cn(
        'absolute top-1.5 left-1.5 inline-flex size-5 items-center justify-center rounded-full bg-[var(--melhor-da-serie)] text-[#2a1c00] shadow-sm shadow-black/40',
        className
      )}
    >
      <Crown className="size-3" aria-hidden />
      <span className="sr-only">{rotulo}</span>
    </span>
  )
}
