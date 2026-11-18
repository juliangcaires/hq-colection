import Link from 'next/link'
import type { ItemDeLista } from '@/lib/queries'
import { AdquirirButton } from '@/components/itens/adquirir-button'
import { DesejoCapa } from '@/components/itens/desejo-capa'
import { hrefDoItem } from '@/lib/navegacao-item'

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * Card de desejo da grade: capa, título, série (e preço) e o botão "Adquiri" em largura total.
 * No modo seleção o card inteiro vira um botão que marca/desmarca, e o "Adquiri" some.
 */
export function DesejoCard({
  item,
  capaUrl,
  de,
  selecionando,
  marcado,
  onAlternar,
}: {
  item: ItemDeLista
  capaUrl: string | null
  /** Página de origem (com filtros) para o Voltar da página do item. */
  de: string
  selecionando: boolean
  marcado: boolean
  onAlternar: () => void
}) {
  const conteudo = (
    <>
      <DesejoCapa
        titulo={item.titulo}
        capaUrl={capaUrl}
        prioridade={item.prioridade}
        marcado={marcado}
        sizes="(max-width: 1024px) 33vw, 160px"
      />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold text-foreground">{item.titulo}</span>
        <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{item.serie?.nome ?? ''}</span>
          {item.preco !== null && <span className="shrink-0 tabular-nums">{BRL.format(item.preco)}</span>}
        </span>
      </div>
    </>
  )

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {selecionando ? (
        <div className="relative flex flex-col gap-2">
          {conteudo}
          <button
            type="button"
            aria-pressed={marcado}
            aria-label={`Selecionar ${item.titulo}`}
            onClick={onAlternar}
            className="absolute inset-0 z-10 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      ) : (
        <>
          <Link href={hrefDoItem(item.id, de)} className="flex flex-col gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {conteudo}
          </Link>
          <AdquirirButton
            itemId={item.id}
            titulo={item.titulo}
            className="h-11 w-full rounded-[9px] px-2 text-[13px] font-semibold lg:h-9"
          />
        </>
      )}
    </div>
  )
}
