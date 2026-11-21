'use client'

import { useTransition } from 'react'
import Image from 'next/image'
import { EyeOff } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Estrelas } from '@/components/ui/estrelas'
import { CriticaSpoiler } from '@/components/ui/critica-spoiler'
import { InteracaoDoItem } from '@/components/feed/interacao-do-item'
import { LoteDoFeed } from '@/components/feed/lote-do-feed'
import { avaliacaoDoPost, ehPostDeLote, tempoRelativo, tituloDoPost, urlDeCapaDoFeed, type PostDoFeed } from '@/lib/feed'
import { formatarNota } from '@/lib/nota'

/** Um "leu X" do feed: quem leu, capa, nota, crítica, curtir e comentar. Todo texto vai como texto puro. */
export function PostDoFeed({ post, onOcultar }: { post: PostDoFeed; onOcultar?: (post: PostDoFeed) => Promise<void> }) {
  const [pendente, startTransition] = useTransition()

  const capa = urlDeCapaDoFeed(post)
  const nome = post.nome || post.apelido || 'Alguém'
  const titulo = tituloDoPost(post)
  const av = avaliacaoDoPost(post)
  // Card de lote do "Li hoje" (0035): capas dos volumes + lista que se expande, no lugar do corpo de um volume.
  const lote = !post.releitura && ehPostDeLote(post) ? post.loteItens : null
  // Post de vários volumes sai inteiro: o aviso diz quantos.
  const tiraVarios = post.qtd > 1 && !post.releitura

  function ocultar() {
    if (!onOcultar) return
    startTransition(async () => {
      await onOcultar(post)
    })
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <header className="flex items-center gap-3">
        <Avatar apelido={post.apelido} nome={post.nome} url={post.avatarUrl} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-sm text-foreground">
            <span className="font-semibold">{post.proprio ? 'Você' : nome}</span> {post.releitura ? 'releu' : 'leu'}
          </p>
          <p className="text-xs text-muted-foreground">
            {!post.proprio && post.apelido ? `@${post.apelido} · ` : ''}
            {tempoRelativo(post.marcadoEm)}
          </p>
        </div>
        {post.proprio && (
          <Button type="button" variant="ghost" size="sm" onClick={ocultar} disabled={pendente} aria-label={tiraVarios ? `Tirar este post do feed (${post.qtd} volumes)` : 'Tirar este post do feed'}>
            <EyeOff aria-hidden /> Tirar do feed
          </Button>
        )}
      </header>

      {lote ? (
        <LoteDoFeed post={post} volumes={lote} />
      ) : (
      <div className="flex gap-3">
        <div className="relative h-[108px] w-[72px] shrink-0 overflow-hidden rounded-lg bg-surface-2">
          {capa && <Image unoptimized src={capa} alt="" fill sizes="72px" className="object-cover" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3 className="font-heading text-base font-bold break-words text-foreground">{titulo}</h3>
          {post.qtd === 1 && post.serieNome && !titulo.startsWith(post.serieNome) && <p className="text-xs text-muted-foreground">{post.serieNome}</p>}
          {av.nota !== null && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <Estrelas valor={av.nota} tamanho={16} mostrarValor={false} />
              <span className="text-sm font-medium text-foreground">{formatarNota(av.nota)}</span>
              {av.rotuloNota && <span className="text-xs text-muted-foreground">{av.rotuloNota}</span>}
            </div>
          )}
          {av.critica && (
            <div className="flex flex-col gap-0.5">
              {av.rotuloCritica && <p className="text-xs text-muted-foreground">{av.rotuloCritica}</p>}
              <CriticaSpoiler texto={av.critica} spoiler={av.spoiler} proprio={post.proprio} />
            </div>
          )}
        </div>
      </div>
      )}

      <InteracaoDoItem itemId={post.itemId} curti={post.curti} curtidas={post.curtidas} comentarios={post.comentarios} />
    </article>
  )
}
