'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { EyeOff, Heart, MessageCircle, Send, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Estrelas } from '@/components/ui/estrelas'
import { Textarea } from '@/components/ui/textarea'
import { alternarCurtida, apagarComentario, comentar, listarComentarios, ocultarDoFeed } from '@/app/(app)/feed/actions'
import { MAX_COMENTARIO, tempoRelativo, tituloDoPost, urlDeCapaDoFeed, type ComentarioDoFeed, type PostDoFeed } from '@/lib/feed'
import { formatarNota } from '@/lib/nota'
import { desembrulhar } from '@/lib/resultado'
import { cn } from '@/lib/utils'

/** Um "leu X" do feed: quem leu, capa, nota, crítica, curtir e comentar. Todo texto vai como texto puro. */
export function PostDoFeed({ post, onOcultar }: { post: PostDoFeed; onOcultar?: (itemId: string) => void }) {
  const [curti, setCurti] = useState(post.curti)
  const [curtidas, setCurtidas] = useState(post.curtidas)
  const [totalComentarios, setTotalComentarios] = useState(post.comentarios)
  const [aberto, setAberto] = useState(false)
  const [comentarios, setComentarios] = useState<ComentarioDoFeed[] | null>(null)
  const [texto, setTexto] = useState('')
  const [pendente, startTransition] = useTransition()

  const capa = urlDeCapaDoFeed(post)
  const nome = post.nome || post.apelido || 'Alguém'
  const titulo = tituloDoPost(post)

  function curtir() {
    const proximo = !curti
    setCurti(proximo)
    setCurtidas((c) => Math.max(0, c + (proximo ? 1 : -1)))
    startTransition(async () => {
      try {
        desembrulhar(await alternarCurtida(post.itemId, proximo))
      } catch (e) {
        setCurti(!proximo)
        setCurtidas((c) => Math.max(0, c + (proximo ? -1 : 1)))
        toast.error(e instanceof Error ? e.message : 'Não foi possível curtir')
      }
    })
  }

  async function recarregar() {
    setComentarios(desembrulhar(await listarComentarios(post.itemId)))
  }

  function alternarComentarios() {
    const abrir = !aberto
    setAberto(abrir)
    if (abrir && comentarios === null) {
      startTransition(async () => {
        try {
          await recarregar()
        } catch (e) {
          setAberto(false)
          toast.error(e instanceof Error ? e.message : 'Não foi possível carregar os comentários')
        }
      })
    }
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    const t = texto.trim()
    if (!t) return
    startTransition(async () => {
      try {
        desembrulhar(await comentar(post.itemId, t))
        setTexto('')
        await recarregar()
        setTotalComentarios((n) => n + 1)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Não foi possível comentar')
      }
    })
  }

  function apagar(id: string) {
    startTransition(async () => {
      try {
        desembrulhar(await apagarComentario(id))
        await recarregar()
        setTotalComentarios((n) => Math.max(0, n - 1))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Não foi possível apagar')
      }
    })
  }

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

      <div className="flex items-center gap-1 border-t border-border pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={curtir} aria-pressed={curti} aria-label={curti ? 'Descurtir' : 'Curtir'} className={cn(curti && 'text-destructive')}>
          <Heart className={cn(curti && 'fill-current')} aria-hidden /> {curtidas > 0 ? curtidas : ''}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={alternarComentarios} aria-expanded={aberto} aria-label="Comentários">
          <MessageCircle aria-hidden /> {totalComentarios > 0 ? totalComentarios : ''}
        </Button>
      </div>

      {aberto && (
        <div className="flex flex-col gap-3">
          {comentarios?.map((c) => (
            <div key={c.id} className="flex gap-2">
              <Avatar apelido={c.apelido} nome={c.nome} url={c.avatarUrl} size={28} />
              <div className="flex min-w-0 flex-1 flex-col rounded-xl bg-surface-2 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{c.meu ? 'Você' : c.nome || c.apelido || 'Alguém'}</span> · {tempoRelativo(c.criadoEm)}
                </p>
                <p className="text-sm break-words whitespace-pre-wrap text-foreground">{c.texto}</p>
              </div>
              {c.podeApagar && (
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => apagar(c.id)} disabled={pendente} aria-label="Apagar comentário">
                  <Trash2 aria-hidden />
                </Button>
              )}
            </div>
          ))}
          <form onSubmit={enviar} className="flex items-end gap-2">
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              maxLength={MAX_COMENTARIO}
              rows={1}
              placeholder="Comentar…"
              aria-label="Escrever um comentário"
              className="min-h-10"
            />
            <Button type="submit" size="icon" disabled={pendente || !texto.trim()} aria-label="Enviar comentário">
              <Send aria-hidden />
            </Button>
          </form>
        </div>
      )}
    </article>
  )
}
