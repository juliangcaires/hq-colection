'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { devolverEmprestimo } from '@/app/(app)/emprestimos/actions'
import { desembrulhar } from '@/lib/resultado'

export function BotaoDevolver({ id, itemId }: { id: string; itemId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  return (
    <Button
      variant="outline"
      className="h-10 shrink-0"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          try {
            desembrulhar(await devolverEmprestimo(id, itemId))
            toast.success('Devolução registrada')
            router.refresh()
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Não foi possível registrar a devolução')
          }
        })
      }
    >
      Devolvido
    </Button>
  )
}
