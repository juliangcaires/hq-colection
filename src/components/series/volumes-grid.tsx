'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ItemCard } from '@/components/itens/item-card'
import { removerItensDaSerie } from '@/app/(app)/series/actions'
import type { ItemComRelacoes } from '@/lib/types'

export function VolumesGrid({
  serieId,
  itens,
  capas,
}: {
  serieId: string
  itens: ItemComRelacoes[]
  /** Entries do Map de signed URLs — Map não atravessa a fronteira servidor→cliente. */
  capas: [string, string][]
}) {
  const router = useRouter()
  const capaMap = new Map(capas)
  const [selecionando, setSelecionando] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [confirmando, setConfirmando] = useState(false)
  const [isPending, startTransition] = useTransition()

  function toggle(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function sairDaSelecao() {
    setSelecionando(false)
    setSelecionados(new Set())
  }

  function handleRemover() {
    const ids = Array.from(selecionados)
    startTransition(async () => {
      try {
        const removidos = await removerItensDaSerie(serieId, ids)
        toast.success(`${removidos} volume(s) removidos da série`)
        setConfirmando(false)
        sairDaSelecao()
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao remover da série')
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        {selecionando ? (
          <>
            <span className="mr-auto text-sm text-muted-foreground">
              {selecionados.size} selecionado(s)
            </span>
            <Button
              size="sm"
              variant="destructive"
              disabled={selecionados.size === 0 || isPending}
              onClick={() => setConfirmando(true)}
            >
              Remover da série
            </Button>
            <Button size="sm" variant="ghost" onClick={sairDaSelecao} disabled={isPending}>
              Cancelar
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setSelecionando(true)}>
            Selecionar
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {itens.map((item) => {
          const capaUrl = capaMap.get(item.capa_url ?? '') ?? null

          if (!selecionando) {
            return <ItemCard key={item.id} item={item} capaUrl={capaUrl} />
          }

          const marcado = selecionados.has(item.id)
          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              aria-pressed={marcado}
              aria-label={`Selecionar ${item.titulo}`}
              onClick={() => toggle(item.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggle(item.id)
                }
              }}
              className="relative cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* Reaproveita o card como está; pointer-events-none neutraliza o <Link> interno. */}
              <div className="pointer-events-none">
                <ItemCard item={item} capaUrl={capaUrl} />
              </div>
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-0 rounded-lg ring-2 transition-colors ${
                  marcado ? 'ring-primary' : 'ring-transparent'
                }`}
              />
              <Checkbox
                checked={marcado}
                onCheckedChange={() => toggle(item.id)}
                onClick={(e) => e.stopPropagation()}
                tabIndex={-1}
                aria-hidden
                className="absolute top-2 left-2 bg-background"
              />
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title={`Remover ${selecionados.size} volume(s) desta série?`}
        description="Os itens continuam na sua coleção, apenas deixam de pertencer a esta série."
        confirmLabel="Remover"
        onConfirm={handleRemover}
        isPending={isPending}
      />
    </div>
  )
}
