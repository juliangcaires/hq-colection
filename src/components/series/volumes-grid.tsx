'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Check } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ItemCard } from '@/components/itens/item-card'
import { removerItensDaSerie } from '@/app/(app)/series/actions'
import { marcarLidoEmLote } from '@/app/(app)/itens/actions'
import { AdquirirDialog } from '@/components/itens/adquirir-button'
import type { ItemComRelacoes } from '@/lib/types'
import { desembrulhar } from '@/lib/resultado'

type Celula = { tipo: 'item'; item: ItemComRelacoes } | { tipo: 'furo'; numero: number }

/** Intercala os furos entre os volumes pela posição numérica; itens sem número vão ao fim. */
function montarCelulas(itens: ItemComRelacoes[], faltantes: number[]): Celula[] {
  const numerados = itens.filter((i) => i.numero_volume !== null)
  const avulsos = itens.filter((i) => i.numero_volume === null)
  const todos: (Celula & { pos: number })[] = [
    ...numerados.map((item) => ({ tipo: 'item' as const, item, pos: item.numero_volume as number })),
    ...faltantes.map((numero) => ({ tipo: 'furo' as const, numero, pos: numero })),
  ]
  todos.sort((a, b) => a.pos - b.pos)
  return [...todos, ...avulsos.map((item) => ({ tipo: 'item' as const, item }))]
}

function VolumeVazio({ numero }: { numero: number }) {
  return (
    <div
      className="flex aspect-[2/3] flex-col items-center justify-center rounded-lg border-2 border-dashed border-warning text-warning-text"
      aria-label={`Volume ${numero} faltando`}
    >
      <span className="font-heading text-base font-extrabold">#{numero}</span>
      <span className="text-[10px]">falta</span>
    </div>
  )
}

export function VolumesGrid({
  serieId,
  itens,
  capas,
  faltantes = [],
}: {
  serieId: string
  itens: ItemComRelacoes[]
  /** Entries do Map de signed URLs — Map não atravessa a fronteira servidor→cliente. */
  capas: [string, string][]
  /** Números de volume que faltam: aparecem na grade, na posição numérica, como slots vazios. */
  faltantes?: number[]
}) {
  const router = useRouter()
  const capaMap = new Map(capas)
  const [selecionando, setSelecionando] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [confirmando, setConfirmando] = useState(false)
  const [adquirindo, setAdquirindo] = useState(false)
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

  const estadosMarcados = itens.filter((i) => selecionados.has(i.id)).map((i) => i.estado)
  const todosDesejo = estadosMarcados.length > 0 && estadosMarcados.every((e) => e === 'desejo')
  const todosComprados = estadosMarcados.length > 0 && estadosMarcados.every((e) => e === 'comprado')

  function handleMarcarLido() {
    startTransition(async () => {
      try {
        const n = desembrulhar(await marcarLidoEmLote(Array.from(selecionados)))
        toast.success(`${n} volume(s) marcados como lidos`)
        sairDaSelecao()
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao marcar como lido')
      }
    })
  }

  function handleRemover() {
    const ids = Array.from(selecionados)
    startTransition(async () => {
      try {
        const removidos = desembrulhar(await removerItensDaSerie(serieId, ids))
        toast.success(`${removidos} volume(s) removidos da série`)
        setConfirmando(false)
        sairDaSelecao()
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao remover da série')
      }
    })
  }

  const celulas = montarCelulas(itens, faltantes)

  return (
    <div className="flex flex-col gap-3">
      {selecionando ? (
        <div
          role="toolbar"
          aria-label="Ações da seleção"
          className="fixed inset-x-3 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-50 flex items-center gap-2 rounded-[18px] border border-border-strong bg-surface-2 p-2 pl-4 shadow-xl shadow-black/40 lg:static lg:rounded-[14px] lg:shadow-none"
        >
          <span className="mr-auto text-sm text-foreground">{selecionados.size} selecionado(s)</span>
          <Button
            variant="outline"
            className="h-11"
            disabled={!todosDesejo || isPending}
            title={selecionados.size > 0 && !todosDesejo ? 'Só para volumes que estão como desejo' : undefined}
            onClick={() => setAdquirindo(true)}
          >
            Marcar como comprado
          </Button>
          <Button
            variant="outline"
            className="h-11"
            disabled={!todosComprados || isPending}
            title={selecionados.size > 0 && !todosComprados ? 'Só para volumes que estão como comprado' : undefined}
            onClick={handleMarcarLido}
          >
            Marcar como lido
          </Button>
          <Button
            variant="destructive"
            className="h-11"
            disabled={selecionados.size === 0 || isPending}
            onClick={() => setConfirmando(true)}
          >
            Remover da série
          </Button>
          <Button variant="ghost" className="h-11 text-link" onClick={sairDaSelecao} disabled={isPending}>
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button variant="ghost" className="h-11 text-link" onClick={() => setSelecionando(true)}>
            Selecionar
          </Button>
        </div>
      )}

      <div className="grid grid-cols-5 gap-2.5 lg:grid-cols-[repeat(auto-fill,minmax(88px,1fr))] lg:gap-3.5">
        {celulas.map((celula) => {
          if (celula.tipo === 'furo') return <VolumeVazio key={`furo-${celula.numero}`} numero={celula.numero} />
          const item = celula.item
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
                className={`pointer-events-none absolute inset-0 rounded-lg transition-shadow ${
                  marcado ? 'shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--primary)]' : ''
                }`}
              />
              {marcado && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1.5 left-1.5 flex size-[22px] items-center justify-center rounded-full bg-primary text-primary-foreground"
                >
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              )}
            </div>
          )
        })}
      </div>

      <AdquirirDialog
        itemIds={Array.from(selecionados)}
        open={adquirindo}
        onOpenChange={setAdquirindo}
        onDone={() => {
          sairDaSelecao()
          router.refresh()
        }}
      />

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
