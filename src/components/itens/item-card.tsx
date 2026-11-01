import Image from 'next/image'
import Link from 'next/link'
import type { ItemDeLista } from '@/lib/queries'
import { cn } from '@/lib/utils'

const SELO =
  'absolute top-1.5 right-1.5 rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase text-primary-foreground'

export function ItemCard({ item, capaUrl }: { item: ItemDeLista; capaUrl: string | null }) {
  const isDesejo = item.estado === 'desejo'
  const isLido = item.estado === 'lido'
  const mostrarNumero = Boolean(item.serie?.tem_numeracao) && item.numero_volume !== null

  return (
    <Link href={`/item/${item.id}`} className="group flex flex-col gap-1.5">
      <div
        className={cn(
          'relative aspect-[2/3] overflow-hidden rounded-lg bg-card ring-1 ring-white/10 transition-shadow group-hover:ring-primary/40',
          isDesejo && 'border-2 border-dashed border-warning opacity-60'
        )}
      >
        {capaUrl ? (
          <Image
            unoptimized
            src={capaUrl}
            alt={item.titulo}
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 22vw, 16vw"
            className="object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full flex-col justify-end p-2 text-left">
            <span className="font-heading text-sm leading-[1.05] font-extrabold text-foreground">
              {item.titulo}
            </span>
          </div>
        )}
        {isLido && <span className={cn(SELO, 'bg-read')}>Lido</span>}
        {isDesejo && <span className={cn(SELO, 'bg-warning')}>Desejo</span>}
      </div>
      <div className="flex flex-col text-[13px] leading-tight">
        <span className="truncate font-medium text-foreground">{item.titulo}</span>
        {item.serie && (
          <span className="truncate text-xs text-muted-foreground">
            {/* Só em série numerada: nas demais o número não significa ordem e só confundiria. */}
            {mostrarNumero && <span className="mr-1 font-semibold text-foreground">#{item.numero_volume}</span>}
            {item.serie.nome}
          </span>
        )}
      </div>
    </Link>
  )
}
