'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Estrelas } from '@/components/ui/estrelas'
import { avaliarSerie } from '@/app/(app)/itens/actions'
import { desembrulhar } from '@/lib/resultado'

/** Nota da série inteira: grava a mesma nota em cada volume já lido. */
export function AvaliarSerie({
  serieId,
  notaAtual,
  lidos,
}: {
  serieId: string
  /** Nota comum aos volumes lidos, quando todos têm a mesma. */
  notaAtual: number | null
  lidos: number
}) {
  const router = useRouter()
  const [nota, setNota] = useState<number | null>(notaAtual)
  const [isPending, startTransition] = useTransition()

  if (lidos === 0) return null

  function aplicar() {
    startTransition(async () => {
      try {
        const n = desembrulhar(await avaliarSerie(serieId, nota))
        toast.success(nota === null ? `Nota removida de ${n} volume(s)` : `Nota aplicada a ${n} volume(s) lido(s)`)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao avaliar a série')
      }
    })
  }

  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card p-4">
      <div className="mr-auto">
        <p className="text-sm font-medium text-foreground">Nota da série</p>
        <p className="text-xs text-muted-foreground">
          Vale para os {lidos} {lidos === 1 ? 'volume lido' : 'volumes lidos'}.
        </p>
      </div>
      <Estrelas valor={nota} onChange={setNota} />
      <Button className="h-11" onClick={aplicar} disabled={isPending || nota === notaAtual}>
        Aplicar aos volumes
      </Button>
    </section>
  )
}
