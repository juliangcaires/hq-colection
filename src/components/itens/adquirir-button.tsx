'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { marcarAdquiri } from '@/app/(app)/itens/actions'

export function AdquirirButton({ itemId, titulo }: { itemId: string; titulo: string }) {
  const [open, setOpen] = useState(false)
  const [preco, setPreco] = useState('')
  const [loja, setLoja] = useState('')
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [isPending, startTransition] = useTransition()

  function handleConfirm() {
    startTransition(async () => {
      try {
        await marcarAdquiri(itemId, {
          preco: preco ? Number(preco) : null,
          loja: loja || null,
          data_aquisicao: data || null,
        })
        toast.success(`"${titulo}" marcado como comprado`)
        setOpen(false)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao marcar aquisição')
      }
    })
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Adquiri
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Marcar aquisição — {titulo}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="preco">Preço (opcional)</Label>
              <Input
                id="preco"
                type="number"
                step="0.01"
                value={preco}
                onChange={(e) => setPreco(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="loja">Loja (opcional)</Label>
              <Input id="loja" value={loja} onChange={(e) => setLoja(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="data">Data</Label>
              <Input id="data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <Button onClick={handleConfirm} disabled={isPending}>
              {isPending ? 'Salvando...' : 'Confirmar aquisição'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
