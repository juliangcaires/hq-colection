import Image from 'next/image'
import Link from 'next/link'
import type { ItemDeLista } from '@/lib/queries'

export function ItemCard({ item, capaUrl }: { item: ItemDeLista; capaUrl: string | null }) {
  const isDesejo = item.estado === 'desejo'
  const isLido = item.estado === 'lido'
  const mostrarNumero = Boolean(item.serie?.tem_numeracao) && item.numero_volume !== null

  return (
    <Link href={`/item/${item.id}`} className="group flex flex-col gap-1.5">
      <div
        className={`relative aspect-[2/3] overflow-hidden rounded-lg bg-card ring-1 ring-border transition-shadow group-hover:ring-primary/40 ${
          isDesejo ? 'border-2 border-dashed border-chart-3/60 opacity-70' : ''
        }`}
      >
        {capaUrl ? (
          <Image unoptimized
            src={capaUrl}
            alt={item.titulo}
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 22vw, 16vw"
            className="object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
            {item.titulo}
          </div>
        )}
        {isLido && (
          <span className="absolute top-1.5 right-1.5 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
            Lido
          </span>
        )}
      </div>
      <div className="flex flex-col">
        <span className="truncate text-sm font-medium text-foreground">{item.titulo}</span>
        {item.serie && (
          <span className="truncate text-xs text-muted-foreground">
            {item.serie.nome}
            {/* Só em série numerada: nas demais o número não significa ordem e só confundiria. */}
            {mostrarNumero && (
              <span className="ml-1 font-medium text-foreground/80">#{item.numero_volume}</span>
            )}
          </span>
        )}
      </div>
    </Link>
  )
}
