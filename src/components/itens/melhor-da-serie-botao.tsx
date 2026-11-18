'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Crown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { definirMelhorDaSerie } from '@/app/(app)/itens/actions'
import { desembrulhar } from '@/lib/resultado'

/**
 * Botão alternável "Melhor da série" na página do volume (0030). Só é renderizado quando a regra permite
 * (`podeMarcarMelhor`); o banco valida de novo. `substitui` é o rótulo do volume que perde a marca, se houver.
 */
export function MelhorDaSerieBotao({
  itemId,
  marcado,
  substitui,
}: {
  itemId: string
  marcado: boolean
  substitui: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [ativo, setAtivo] = useState(marcado)

  function alternar() {
    const proximo = !ativo
    startTransition(async () => {
      try {
        desembrulhar(await definirMelhorDaSerie(itemId, proximo))
        setAtivo(proximo)
        toast.success(proximo ? 'Marcado como melhor da série' : 'Marca de melhor da série removida')
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível salvar a marca')
      }
    })
  }

  return (
    <div className="flex w-full basis-full flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2/60 p-3 text-sm">
      <Crown className="size-5 shrink-0 text-[var(--melhor-da-serie)]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Melhor da série</p>
        <p className="text-xs text-muted-foreground">
          {ativo
            ? 'Este é o seu volume favorito desta série.'
            : substitui
              ? `Vai substituir ${substitui}.`
              : 'Destaque o volume que você mais gostou desta série.'}
        </p>
      </div>
      <Button
        type="button"
        variant={ativo ? 'default' : 'outline'}
        className="h-10"
        aria-pressed={ativo}
        disabled={isPending}
        onClick={alternar}
      >
        {ativo ? 'Melhor da série ✓ (desmarcar)' : 'Marcar como melhor da série'}
      </Button>
    </div>
  )
}
