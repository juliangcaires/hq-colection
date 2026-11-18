'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AdquirirButton } from '@/components/itens/adquirir-button'
import { DesejoCapa } from '@/components/itens/desejo-capa'
import { TipoBadge } from '@/components/ui/tipo-badge'
import type { GrupoDeDesejos } from '@/lib/desejos-agrupados'
import { hrefDoItem } from '@/lib/navegacao-item'
import type { ItemDeLista } from '@/lib/queries'
import { cn } from '@/lib/utils'

/** Quantas capas o grupo mostra no desktop antes do tile "+N". */
const VISIVEIS = 4

/**
 * Um grupo do modo "Agrupar por série": cabeçalho (série, tipo, quantos desejos, "Ver série") e a linha
 * de volumes. No desktop mostra até 4 capas e um tile "+N" que expande o grupo (e colapsa de volta);
 * no mobile a linha vira scroll horizontal com todos.
 */
export function DesejosGrupo({
  grupo,
  capas,
  de,
  selecionando,
  selecionados,
  onAlternar,
}: {
  grupo: GrupoDeDesejos<ItemDeLista>
  capas: Map<string, string>
  de: string
  selecionando: boolean
  selecionados: Set<string>
  onAlternar: (id: string) => void
}) {
  const [expandido, setExpandido] = useState(false)
  const total = grupo.itens.length
  const restante = total - VISIVEIS

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2.5">
        <h2 className="min-w-0 truncate font-heading text-lg font-bold text-foreground">
          {grupo.serieId ? (
            <Link href={`/serie/${grupo.serieId}`} className="hover:text-primary hover:underline">
              {grupo.nome}
            </Link>
          ) : (
            grupo.nome
          )}
        </h2>
        {grupo.tipo && <TipoBadge tipo={grupo.tipo} className="shrink-0" />}
        <span className="flex-1 text-sm whitespace-nowrap text-warning-text">
          {total} {total === 1 ? 'desejo' : 'desejos'}
        </span>
        {grupo.serieId && (
          <Link
            href={`/serie/${grupo.serieId}`}
            className="flex h-11 shrink-0 items-center px-2.5 text-[13px] font-semibold text-link hover:underline"
          >
            Ver série
          </Link>
        )}
      </div>

      <div
        className={cn(
          '-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1',
          'lg:mx-0 lg:snap-none lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0'
        )}
      >
        {grupo.itens.map((item, i) => {
          const marcado = selecionados.has(item.id)
          const numero = item.serie?.tem_numeracao ? item.numero_volume : null
          const capa = (
            <DesejoCapa
              titulo={item.titulo}
              capaUrl={capas.get(item.capa_url ?? '') ?? null}
              prioridade={item.prioridade}
              numero={numero}
              marcado={marcado}
              compacta
              sizes="96px"
            />
          )
          return (
            <div
              key={item.id}
              // Fora do desktop todos aparecem (scroll horizontal); no desktop, só os primeiros até expandir.
              className={cn('flex w-24 flex-none snap-start flex-col gap-1.5', !expandido && i >= VISIVEIS && 'lg:hidden')}
            >
              {selecionando ? (
                <div className="relative">
                  {capa}
                  <button
                    type="button"
                    aria-pressed={marcado}
                    aria-label={`Selecionar ${item.titulo}`}
                    onClick={() => onAlternar(item.id)}
                    className="absolute inset-0 z-10 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              ) : (
                <>
                  <Link
                    href={hrefDoItem(item.id, de)}
                    aria-label={item.titulo}
                    className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {capa}
                  </Link>
                  <AdquirirButton
                    itemId={item.id}
                    titulo={item.titulo}
                    className="h-11 w-full rounded-lg px-1 text-xs font-semibold lg:h-8"
                  />
                </>
              )}
            </div>
          )
        })}

        {restante > 0 && (
          <button
            type="button"
            aria-expanded={expandido}
            aria-label={
              expandido
                ? `Mostrar menos desejos de ${grupo.nome}`
                : `Mostrar mais ${restante} ${restante === 1 ? 'desejo' : 'desejos'} de ${grupo.nome}`
            }
            onClick={() => setExpandido((v) => !v)}
            className="hidden aspect-[2/3] w-24 flex-none items-center justify-center rounded-md border border-border px-1 text-center text-sm font-semibold text-link outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring lg:flex"
          >
            {expandido ? 'Menos' : `+${restante}`}
          </button>
        )}
      </div>
    </section>
  )
}
