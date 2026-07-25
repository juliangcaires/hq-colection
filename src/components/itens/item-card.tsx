import Image from 'next/image'
import Link from 'next/link'
import type { ItemComRelacoes } from '@/lib/types'

export function ItemCard({ item, capaUrl }: { item: ItemComRelacoes; capaUrl: string | null }) {
  const isDesejo = item.estado === 'desejo'
  const isLido = item.estado === 'lido'

  return (
    <Link href={`/item/${item.id}`} className="group flex flex-col gap-1.5">
      <div
        className={`relative aspect-[2/3] overflow-hidden rounded-md bg-neutral-800 ${
          isDesejo ? 'border-2 border-dashed border-neutral-600 opacity-60' : ''
        }`}
      >
        {capaUrl ? (
          <Image
            src={capaUrl}
            alt={item.titulo}
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 22vw, 16vw"
            className="object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-neutral-500">
            {item.titulo}
          </div>
        )}
        {isLido && (
          <span className="absolute right-1 top-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            Lido
          </span>
        )}
      </div>
      <div className="flex flex-col">
        <span className="truncate text-sm font-medium text-neutral-100">{item.titulo}</span>
        {item.serie && <span className="truncate text-xs text-neutral-500">{item.serie.nome}</span>}
      </div>
    </Link>
  )
}
