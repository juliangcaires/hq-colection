'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { removerItensEmLote } from '@/app/(app)/itens/actions'
import { desembrulhar } from '@/lib/resultado'
import { Checkbox } from '@/components/ui/checkbox'
import { AdquirirButton, AdquirirDialog } from '@/components/itens/adquirir-button'
import type { ItemDeLista } from '@/lib/queries'

type ItemDesejo = ItemDeLista

export function DesejosLista({
  itens,
  capas,
}: {
  itens: ItemDesejo[]
  /** Entries do Map de signed URLs — Map não atravessa a fronteira servidor→cliente. */
  capas: [string, string][]
}) {
  const router = useRouter()
  const capaMap = new Map(capas)
  const [selecionando, setSelecionando] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [adquirindo, setAdquirindo] = useState(false)
  const [removendo, setRemovendo] = useState(false)
  const [isPending, startTransition] = useTransition()

  function remover() {
    startTransition(async () => {
      try {
        const n = desembrulhar(await removerItensEmLote(Array.from(selecionados)))
        toast.success(`${n} ${n === 1 ? 'desejo removido' : 'desejos removidos'}`)
        setRemovendo(false)
        sairDaSelecao()
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao remover')
      }
    })
  }

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

  // Os filtros da tela já recortaram a lista, então "todos" quer dizer os que
  // estão à vista — que é justamente o que a pessoa acabou de filtrar.
  const todosMarcados = itens.length > 0 && selecionados.size === itens.length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {selecionando ? (
          <>
            <span className="mr-auto text-sm text-muted-foreground">
              {selecionados.size} selecionado(s)
            </span>
            <Button
              variant="ghost"
              className="h-11 text-link"
              onClick={() =>
                setSelecionados(todosMarcados ? new Set() : new Set(itens.map((i) => i.id)))
              }
            >
              {todosMarcados ? 'Limpar' : 'Selecionar todos'}
            </Button>
            <Button
              className="h-11"
              disabled={selecionados.size === 0}
              onClick={() => setAdquirindo(true)}
            >
              Adquirir {selecionados.size}
            </Button>
            <Button
              variant="destructive"
              className="h-11"
              disabled={selecionados.size === 0}
              onClick={() => setRemovendo(true)}
            >
              Remover {selecionados.size > 0 ? selecionados.size : ''}
            </Button>
            <Button variant="ghost" className="h-11 text-link" onClick={sairDaSelecao}>
              Cancelar
            </Button>
          </>
        ) : (
          <Button variant="ghost" className="h-11 text-link" onClick={() => setSelecionando(true)}>
            Selecionar
          </Button>
        )}
      </div>

      <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        {itens.map((item) => {
          const capaUrl = capaMap.get(item.capa_url ?? '') ?? null
          const marcado = selecionados.has(item.id)

          const conteudo = (
            <>
              <div className="relative h-[78px] w-[52px] flex-shrink-0 overflow-hidden rounded border-2 border-dashed border-warning/70 bg-surface-2">
                {capaUrl && (
                  <Image unoptimized src={capaUrl} alt={item.titulo} fill sizes="52px" className="object-cover" />
                )}
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{item.titulo}</span>
                {item.serie && <span className="truncate text-xs text-muted-foreground">{item.serie.nome}</span>}
                <span className="mt-1 flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      item.prioridade > 0 ? 'bg-warning text-primary-foreground' : 'bg-border text-muted-foreground'
                    }`}
                  >
                    Prioridade {item.prioridade}
                  </span>
                  {item.preco !== null && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {item.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                  )}
                </span>
              </div>
            </>
          )

          if (!selecionando) {
            return (
              <div key={item.id} className="flex items-center gap-3 p-3">
                <Link href={`/item/${item.id}`} className="flex flex-1 items-center gap-3 overflow-hidden">
                  {conteudo}
                </Link>
                <AdquirirButton itemId={item.id} titulo={item.titulo} />
              </div>
            )
          }

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
              className={`flex cursor-pointer items-center gap-3 p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                marcado ? 'bg-primary/10' : ''
              }`}
            >
              <Checkbox
                checked={marcado}
                onCheckedChange={() => toggle(item.id)}
                onClick={(e) => e.stopPropagation()}
                tabIndex={-1}
                aria-hidden
                className="flex-shrink-0"
              />
              {/* Sem <Link> no modo seleção: um clique aqui seleciona, não navega. */}
              <div className="flex flex-1 items-center gap-3 overflow-hidden">{conteudo}</div>
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={removendo}
        onOpenChange={setRemovendo}
        title={`Remover ${selecionados.size} ${selecionados.size === 1 ? 'desejo' : 'desejos'}?`}
        description="Isso apaga os itens e as capas deles. Não dá para desfazer."
        confirmLabel="Remover"
        onConfirm={remover}
        isPending={isPending}
      />

      <AdquirirDialog
        itemIds={Array.from(selecionados)}
        open={adquirindo}
        onOpenChange={setAdquirindo}
        onDone={() => {
          sairDaSelecao()
          router.refresh()
        }}
      />
    </div>
  )
}
