'use client'

import { useTransition } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { EyeOff } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Estrelas } from '@/components/ui/estrelas'
import { InteracaoDoItem } from '@/components/feed/interacao-do-item'
import { ocultarDoFeed } from '@/app/(app)/feed/actions'
import { tempoRelativo, tituloDoPost, urlDeCapaDoFeed, type PostDoFeed } from '@/lib/feed'
import { formatarNota } from '@/lib/nota'
import { desembrulhar } from '@/lib/resultado'

/** Um "leu X" do feed: quem leu, capa, nota, crítica, curtir e comentar. Todo texto vai como texto puro. */
export function PostDoFeed({ post, onOcultar }: { post: PostDoFeed; onOcultar?: (itemId: string) => void }) {
  const [pendente, startTransition] = useTransition()

  const capa = urlDeCapaDoFeed(post)
  const nome = post.nome || post.apelido || 'Alguém'
  const titulo = tituloDoPost(post)

  function ocultar() {
    startTransition(async () => {
      try {
        desembrulhar(await ocultarDoFeed(post.itemId, true))
        onOcultar?.(post.itemId)
        toast.success('Tirei do feed. A nota e a crítica continuam no seu item.')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Não foi possível tirar do feed')
      }
    })
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <header className="flex items-center gap-3">
        <Avatar apelido={post.apelido} nome={post.nome} url={post.avatarUrl} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-sm text-foreground">
            <span className="font-semibold">{post.proprio ? 'Você' : nome}</span> {post.proprio ? 'leu' : 'leu'}
          </p>
          <p className="text-xs text-muted-foreground">
            {!post.proprio && post.apelido ? `@${post.apelido} · ` : ''}
            {tempoRelativo(post.marcadoEm)}
          </p>
        </div>
        {post.proprio && (
          <Button type="button" variant="ghost" size="sm" onClick={ocultar} disabled={pendente} aria-label="Tirar este post do feed">
            <EyeOff aria-hidden /> Tirar do feed
          </Button>
        )}
      </header>

      <div className="flex gap-3">
        <div className="relative h-[108px] w-[72px] shrink-0 overflow-hidden rounded-lg bg-surface-2">
          {capa && <Image unoptimized src={capa} alt="" fill sizes="72px" className="object-cover" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3 className="font-heading text-base font-bold break-words text-foreground">{titulo}</h3>
          {post.qtd === 1 && post.serieNome && !titulo.startsWith(post.serieNome) && <p className="text-xs text-muted-foreground">{post.serieNome}</p>}
          {post.nota !== null && post.qtd === 1 && (
            <div className="flex items-center gap-2">
              <Estrelas valor={post.nota} tamanho={16} mostrarValor={false} />
              <span className="text-sm font-medium text-foreground">{formatarNota(post.nota)}</span>
            </div>
          )}
          {post.critica && post.qtd === 1 && <p className="text-sm break-words whitespace-pre-wrap text-foreground/90">{post.critica}</p>}
        </div>
      </div>

      <InteracaoDoItem itemId={post.itemId} curti={post.curti} curtidas={post.curtidas} comentarios={post.comentarios} />
    </article>
  )
}
