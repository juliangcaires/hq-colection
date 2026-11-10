'use client'

import { createContext, useContext, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { MarcarLidoDialog } from '@/components/itens/marcar-lido-dialog'
import { AdquirirDialog } from '@/components/itens/adquirir-button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { desmarcarLidoEmLote, marcarLidoEmLote, removerItensEmLote } from '@/app/(app)/itens/actions'
import { desembrulhar } from '@/lib/resultado'
import type { EstadoItem } from '@/lib/types'
import { cn } from '@/lib/utils'

type Contexto = {
  selecionando: boolean
  selecionados: Map<string, EstadoItem>
  alternar: (id: string, estado: EstadoItem) => void
}

const SelecaoContext = createContext<Contexto | null>(null)

export type ItemSelecionavel = { id: string; estado: EstadoItem; titulo: string }

/**
 * Modo de seleção da coleção: a barra (Selecionar / Remover / Marcar como lido) e o contexto que os
 * cards usam. "Marcar como lido" só liga quando TODOS os marcados estão comprados.
 */
export function SelecaoItens({ itens, children }: { itens: ItemSelecionavel[]; children: ReactNode }) {
  const router = useRouter()
  const [selecionando, setSelecionando] = useState(false)
  const [selecionados, setSelecionados] = useState<Map<string, EstadoItem>>(new Map())
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false)
  const [adquirindo, setAdquirindo] = useState(false)
  const [avaliando, setAvaliando] = useState(false)
  const [isPending, startTransition] = useTransition()

  function alternar(id: string, estado: EstadoItem) {
    setSelecionados((prev) => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, estado)
      return next
    })
  }

  function sair() {
    setSelecionando(false)
    setSelecionados(new Map())
  }

  const todosMarcados = itens.length > 0 && selecionados.size === itens.length
  const podeMarcarLido = selecionados.size > 0 && Array.from(selecionados.values()).every((e) => e === 'comprado')
  const podeDesmarcarLido = selecionados.size > 0 && Array.from(selecionados.values()).every((e) => e === 'lido')
  const podeComprar = selecionados.size > 0 && Array.from(selecionados.values()).every((e) => e === 'desejo')
  const ids = Array.from(selecionados.keys())

  function marcarLido() {
    // Um item só: abre o diálogo de nota e crítica. Em lote, marca direto, sem pedir avaliação a cada um.
    if (ids.length === 1) {
      setAvaliando(true)
      return
    }
    startTransition(async () => {
      try {
        const n = desembrulhar(await marcarLidoEmLote(ids))
        toast.success(`${n} ${n === 1 ? 'item marcado' : 'itens marcados'} como lido`)
        sair()
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao marcar como lido')
      }
    })
  }

  function desmarcarLido() {
    startTransition(async () => {
      try {
        const n = desembrulhar(await desmarcarLidoEmLote(ids))
        toast.success(`${n} ${n === 1 ? 'item voltou' : 'itens voltaram'} para comprado`)
        sair()
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao remover como lido')
      }
    })
  }

  function remover() {
    startTransition(async () => {
      try {
        const n = desembrulhar(await removerItensEmLote(ids))
        toast.success(`${n} ${n === 1 ? 'item removido' : 'itens removidos'}`)
        setConfirmandoRemocao(false)
        sair()
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao remover')
      }
    })
  }

  return (
    <SelecaoContext.Provider value={{ selecionando, selecionados, alternar }}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selecionando ? (
            <>
              <span className="mr-auto text-sm text-muted-foreground">{selecionados.size} selecionado(s)</span>
              <Button
                variant="ghost"
                className="h-11 text-link"
                onClick={() =>
                  setSelecionados(todosMarcados ? new Map() : new Map(itens.map((i) => [i.id, i.estado])))
                }
              >
                {todosMarcados ? 'Limpar' : 'Selecionar todos'}
              </Button>
              <Button
                variant="outline"
                className="h-11"
                disabled={!podeComprar || isPending}
                title={
                  selecionados.size > 0 && !podeComprar
                    ? 'Só dá para marcar como comprado quando todos os selecionados são desejos'
                    : undefined
                }
                onClick={() => setAdquirindo(true)}
              >
                Marcar como comprado
              </Button>
              <Button
                variant="outline"
                className="h-11"
                disabled={!podeMarcarLido || isPending}
                title={
                  selecionados.size > 0 && !podeMarcarLido
                    ? 'Só dá para marcar como lido quando todos os selecionados estão comprados'
                    : undefined
                }
                onClick={marcarLido}
              >
                Marcar como lido
              </Button>
              <Button
                variant="outline"
                className="h-11"
                disabled={!podeDesmarcarLido || isPending}
                title={
                  selecionados.size > 0 && !podeDesmarcarLido
                    ? 'Só dá para remover como lido quando todos os selecionados estão lidos'
                    : undefined
                }
                onClick={desmarcarLido}
              >
                Remover como lido
              </Button>
              <Button
                variant="destructive"
                className="h-11"
                disabled={selecionados.size === 0 || isPending}
                onClick={() => setConfirmandoRemocao(true)}
              >
                Remover {selecionados.size > 0 ? selecionados.size : ''}
              </Button>
              <Button variant="ghost" className="h-11 text-link" onClick={sair}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button variant="ghost" className="h-11 text-link" onClick={() => setSelecionando(true)}>
              Selecionar
            </Button>
          )}
        </div>

        {children}
      </div>

      {ids.length === 1 && (
        <MarcarLidoDialog
          itemId={ids[0]}
          titulo={itens.find((i) => i.id === ids[0])?.titulo ?? ''}
          open={avaliando}
          onOpenChange={setAvaliando}
          onDone={() => {
            sair()
            router.refresh()
          }}
        />
      )}

      <AdquirirDialog
        itemIds={ids}
        open={adquirindo}
        onOpenChange={setAdquirindo}
        onDone={() => {
          sair()
          router.refresh()
        }}
      />

      <ConfirmDialog
        open={confirmandoRemocao}
        onOpenChange={setConfirmandoRemocao}
        title={`Remover ${selecionados.size} ${selecionados.size === 1 ? 'item' : 'itens'}?`}
        description="Isso apaga os itens e as capas deles. Não dá para desfazer."
        confirmLabel="Remover"
        onConfirm={remover}
        isPending={isPending}
      />
    </SelecaoContext.Provider>
  )
}

/** Envolve um card: no modo seleção, o clique marca em vez de abrir o item. */
export function CardSelecionavel({ item, children }: { item: ItemSelecionavel; children: ReactNode }) {
  const ctx = useContext(SelecaoContext)
  if (!ctx || !ctx.selecionando) return <>{children}</>

  const marcado = ctx.selecionados.has(item.id)
  return (
    <div className="relative">
      {children}
      <button
        type="button"
        aria-pressed={marcado}
        aria-label={`Selecionar item`}
        onClick={() => ctx.alternar(item.id, item.estado)}
        className={cn(
          'absolute inset-0 z-10 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring',
          marcado && 'bg-primary/20 ring-2 ring-primary'
        )}
      >
        <Checkbox
          checked={marcado}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute top-1.5 left-1.5 size-5 bg-background"
        />
      </button>
    </div>
  )
}
