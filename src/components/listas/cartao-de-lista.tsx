import Image from 'next/image'
import Link from 'next/link'
import { Heart, MessageCircle } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { ROTULOS_TIPO_DE_LISTA, rotuloDeItens, urlDeCapaDaLista, type ResumoDeLista } from '@/lib/listas'

/** Cartão de uma lista na página Listas: capa do primeiro item, título, tipo, quantidade e quem fez. Texto sempre puro. */
export function CartaoDeLista({ lista }: { lista: ResumoDeLista }) {
  const capa = urlDeCapaDaLista(lista.capa, lista.capaItem)
  const nome = lista.nome || lista.apelido || 'Alguém'
  return (
    <Link
      href={`/listas/${lista.id}`}
      className="flex min-h-[92px] gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:bg-white/[0.03] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="relative h-[84px] w-14 shrink-0 overflow-hidden rounded-lg bg-surface-2">
        {capa && <Image unoptimized src={capa} alt="" fill sizes="56px" className="object-cover" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="font-heading text-base leading-tight font-bold break-words text-foreground">{lista.titulo}</h3>
        <p className="text-xs text-muted-foreground">
          {[lista.tipo ? ROTULOS_TIPO_DE_LISTA[lista.tipo] : null, lista.ordenada ? 'ordenada' : null, rotuloDeItens(lista.qtd)].filter(Boolean).join(' · ')}
        </p>
        {!lista.proprio && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Avatar apelido={lista.apelido} nome={lista.nome} url={lista.avatarUrl} size={18} />
            <span className="truncate">{nome}</span>
          </p>
        )}
        <p className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Heart className="size-3.5" aria-hidden /> {lista.curtidas}
            <span className="sr-only">curtidas</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="size-3.5" aria-hidden /> {lista.comentarios}
            <span className="sr-only">comentários</span>
          </span>
        </p>
      </div>
    </Link>
  )
}
