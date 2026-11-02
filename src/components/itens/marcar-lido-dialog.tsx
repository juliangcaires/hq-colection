'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Estrelas } from '@/components/ui/estrelas'
import { marcarLidoEmLote } from '@/app/(app)/itens/actions'
import { desembrulhar } from '@/lib/resultado'

/** Marca um item como lido já pedindo nota e crítica — as duas são opcionais ("Pular" só marca). */
export function MarcarLidoDialog({
  itemId,
  titulo,
  open,
  onOpenChange,
  onDone,
}: {
  itemId: string
  titulo: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const [nota, setNota] = useState<number | null>(null)
  const [critica, setCritica] = useState('')
  const [isPending, startTransition] = useTransition()

  function salvar(comAvaliacao: boolean) {
    startTransition(async () => {
      try {
        desembrulhar(await marcarLidoEmLote([itemId], comAvaliacao ? { nota, critica: critica || null } : undefined))
        toast.success(`"${titulo}" marcado como lido`)
        onOpenChange(false)
        setNota(null)
        setCritica('')
        onDone?.()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao marcar como lido')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Marcar como lido</DialogTitle>
          <DialogDescription className="truncate">{titulo}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Nota</Label>
            <Estrelas valor={nota} onChange={setNota} tamanho={36} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="critica-lido">Crítica</Label>
            <Textarea
              id="critica-lido"
              rows={4}
              maxLength={2000}
              value={critica}
              onChange={(e) => setCritica(e.target.value)}
              placeholder="O que você achou da leitura? (opcional)"
              className="rounded-xl bg-surface-2"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => salvar(false)} disabled={isPending}>
            Pular
          </Button>
          <Button onClick={() => salvar(true)} disabled={isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
