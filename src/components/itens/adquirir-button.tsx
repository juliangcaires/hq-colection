'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { marcarAdquiriEmLote } from '@/app/(app)/itens/actions'
import { desembrulhar } from '@/lib/resultado'
import { numeroInvalido, parseNumeroPtBr } from '@/lib/numeros'

/**
 * Marca aquisição de um item ou de vários — é o mesmo diálogo porque os campos
 * são os mesmos: preço, loja e data valem para todo o lote. Só o texto muda.
 */
export function AdquirirDialog({
  itemIds,
  titulo,
  open,
  onOpenChange,
  onDone,
}: {
  itemIds: string[]
  /** Título do item, quando é um só — no lote a contagem fala por si. */
  titulo?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const [preco, setPreco] = useState('')
  const [loja, setLoja] = useState('')
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [isPending, startTransition] = useTransition()

  const lote = itemIds.length > 1

  function handleConfirm() {
    if (numeroInvalido(preco)) {
      toast.error('Preço inválido')
      return
    }
    startTransition(async () => {
      try {
        const afetados = desembrulhar(await marcarAdquiriEmLote(itemIds, {
          preco: parseNumeroPtBr(preco),
          loja: loja || null,
          data_aquisicao: data || null,
        }))
        toast.success(
          lote
            ? `${afetados} item(ns) marcados como comprados`
            : `"${titulo}" marcado como comprado`
        )
        onOpenChange(false)
        onDone?.()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao marcar aquisição')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {lote ? `Adquirir ${itemIds.length} itens` : `Marcar aquisição — ${titulo}`}
          </DialogTitle>
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
            {lote && (
              <p className="text-xs text-muted-foreground">
                Preço de cada item — o mesmo valor vai para os {itemIds.length}.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="loja">Loja (opcional)</Label>
            <Input id="loja" value={loja} onChange={(e) => setLoja(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="data">Data</Label>
            <Input id="data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <Button onClick={handleConfirm} disabled={isPending || itemIds.length === 0}>
            {isPending
              ? 'Salvando...'
              : lote
                ? `Confirmar aquisição de ${itemIds.length}`
                : 'Confirmar aquisição'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Botão de linha da lista de desejos: abre o diálogo para um único item. */
export function AdquirirButton({ itemId, titulo }: { itemId: string; titulo: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Adquiri
      </Button>
      <AdquirirDialog itemIds={[itemId]} titulo={titulo} open={open} onOpenChange={setOpen} />
    </>
  )
}
