'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Heart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { removerItensEmLote } from '@/app/(app)/itens/actions'
import { desembrulhar } from '@/lib/resultado'
import { AdquirirDialog } from '@/components/itens/adquirir-button'
import { DesejoCard } from '@/components/itens/desejo-card'
import { DesejosFiltros } from '@/components/itens/desejos-filtros'
import { DesejosGrupo } from '@/components/itens/desejos-grupo'
import { useQuickAdd } from '@/components/quick-add/quick-add-provider'
import type { GrupoDeDesejos, OrdemDesejos } from '@/lib/desejos-agrupados'
import type { ItemDeLista } from '@/lib/queries'
import type { TagLite } from '@/lib/types'

type SerieOpcao = { id: string; nome: string; tagIds: string[] }

/**
 * Corpo da tela de Desejos: a barra de filtros, a seleção em lote e a lista — em grade de capas
 * (padrão) ou agrupada por série. Os dois modos usam o mesmo estado de seleção.
 */
export function DesejosLista({
  itens,
  grupos,
  capas,
  series,
  tags,
  ordem,
  agrupar,
  temFiltros,
}: {
  /** Desejos à vista (na grade, os da página atual; no modo agrupado, todos). */
  itens: ItemDeLista[]
  /** Só no modo agrupado. */
  grupos: GrupoDeDesejos<ItemDeLista>[] | null
  /** Entries do Map de signed URLs — Map não atravessa a fronteira servidor→cliente. */
  capas: [string, string][]
  series: SerieOpcao[]
  tags: TagLite[]
  ordem: OrdemDesejos
  agrupar: boolean
  /** Há busca, tipo, série, tag ou "Sem capa" na URL — distingue "lista vazia" de "filtro sem resultado". */
  temFiltros: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { abrir: abrirQuickAdd } = useQuickAdd()
  const capaMap = new Map(capas)
  const [selecionando, setSelecionando] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [adquirindo, setAdquirindo] = useState(false)
  const [removendo, setRemovendo] = useState(false)
  const [isPending, startTransition] = useTransition()

  // O Voltar da página do item volta para esta mesma visão (modo, busca, filtros, ordenação).
  const qs = searchParams.toString()
  const de = qs ? `/desejos?${qs}` : '/desejos'
  const totalSeries = grupos ? grupos.filter((g) => g.serieId).length : 0

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

  function alternar(id: string) {
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
    <div className="flex flex-col gap-4">
      <DesejosFiltros
        series={series}
        tags={tags}
        ordem={ordem}
        agrupar={agrupar}
        totalSeries={totalSeries}
        selecionar={
          itens.length > 0 && !selecionando ? (
            <Button variant="ghost" className="h-11 shrink-0 px-3.5 text-link" onClick={() => setSelecionando(true)}>
              Selecionar
            </Button>
          ) : null
        }
      />

      {selecionando && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-sm text-muted-foreground">{selecionados.size} selecionado(s)</span>
          <Button
            variant="ghost"
            className="h-11 text-link"
            onClick={() => setSelecionados(todosMarcados ? new Set() : new Set(itens.map((i) => i.id)))}
          >
            {todosMarcados ? 'Limpar' : 'Selecionar todos'}
          </Button>
          <Button className="h-11" disabled={selecionados.size === 0} onClick={() => setAdquirindo(true)}>
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
        </div>
      )}

      {itens.length === 0 ? (
        temFiltros ? (
          <EstadoVazio titulo="Nenhum desejo com esses filtros">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => {
                // Modo e ordenação são da tela, não filtros: sobrevivem ao "limpar".
                const params = new URLSearchParams()
                if (agrupar) params.set('agrupar', 'serie')
                if (ordem !== 'prioridade') params.set('ordem', ordem)
                const q = params.toString()
                router.push(q ? `/desejos?${q}` : '/desejos')
              }}
            >
              Limpar filtros
            </Button>
          </EstadoVazio>
        ) : (
          <EstadoVazio titulo="Sua lista de desejos está vazia">
            <Button className="h-11" onClick={abrirQuickAdd}>
              Adicionar item
            </Button>
          </EstadoVazio>
        )
      ) : grupos ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[repeat(auto-fill,minmax(480px,1fr))]">
          {grupos.map((grupo) => (
            <DesejosGrupo
              key={grupo.serieId ?? '__avulsos__'}
              grupo={grupo}
              capas={capaMap}
              de={de}
              selecionando={selecionando}
              selecionados={selecionados}
              onAlternar={alternar}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 lg:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] lg:gap-x-4 lg:gap-y-5">
          {itens.map((item) => (
            <DesejoCard
              key={item.id}
              item={item}
              capaUrl={capaMap.get(item.capa_url ?? '') ?? null}
              de={de}
              selecionando={selecionando}
              marcado={selecionados.has(item.id)}
              onAlternar={() => alternar(item.id)}
            />
          ))}
        </div>
      )}

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

function EstadoVazio({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <span className="flex size-14 items-center justify-center rounded-full border-2 border-dashed border-warning text-warning-text">
        <Heart className="size-6" aria-hidden />
      </span>
      <p className="font-heading text-lg font-bold text-foreground">{titulo}</p>
      {children}
    </div>
  )
}
