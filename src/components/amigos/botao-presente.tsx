'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Gift } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { desmarcarPresente, marcarPresente } from '@/app/(app)/amigos/actions'
import { desembrulhar } from '@/lib/resultado'

/**
 * "Vou dar esse" na lista de desejos de um amigo. Outros amigos veem que já tem presente marcado (sem saber por
 * quem); o dono da lista não vê nada.
 */
export function BotaoPresente({
  itemId,
  apelido,
  reservado,
  reservadoPorMim,
}: {
  itemId: string
  apelido: string
  reservado: boolean
  reservadoPorMim: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function alternar() {
    startTransition(async () => {
      try {
        desembrulhar(reservadoPorMim ? await desmarcarPresente(itemId, apelido) : await marcarPresente(itemId, apelido))
        toast.success(reservadoPorMim ? 'Marcação removida' : 'Marcado! Os outros amigos vão ver que este já tem presente.')
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível salvar')
        router.refresh()
      }
    })
  }

  if (reservado && !reservadoPorMim) {
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Gift className="size-3.5" aria-hidden /> Já tem presente marcado
      </p>
    )
  }
  return (
    <Button
      variant={reservadoPorMim ? 'secondary' : 'outline'}
      className="h-9 w-full gap-1.5 px-2 text-xs"
      onClick={alternar}
      disabled={isPending}
      aria-pressed={reservadoPorMim}
    >
      <Gift className="size-3.5" aria-hidden />
      {reservadoPorMim ? 'Você vai dar (desmarcar)' : 'Vou dar esse'}
    </Button>
  )
}
