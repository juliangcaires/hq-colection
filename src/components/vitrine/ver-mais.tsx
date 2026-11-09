import Link from 'next/link'
import { ITENS_POR_PAGINA } from '@/lib/filtros-url'

/** "Ver mais" por link (`?limite=`), sem JavaScript: a página é só leitura. */
export function VerMais({ href, mostrados, total, limite }: { href: string; mostrados: number; total: number; limite: number }) {
  if (mostrados >= total) return null
  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <p className="text-xs text-muted-foreground">
        Mostrando {mostrados} de {total}
      </p>
      <Link href={`${href}?limite=${limite + ITENS_POR_PAGINA}`} scroll={false} className="flex h-11 items-center rounded-xl border border-border px-5 text-sm font-medium text-foreground">
        Ver mais
      </Link>
    </div>
  )
}
