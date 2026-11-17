'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Heart, MessageCircle, Send, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { alternarCurtida, apagarComentario, comentar, listarComentarios } from '@/app/(app)/feed/actions'
import { MAX_COMENTARIO, tempoRelativo, type ComentarioDoFeed } from '@/lib/feed'
import { desembrulhar } from '@/lib/resultado'
import { cn } from '@/lib/utils'

/**
 * Curtir e comentar uma avaliação (o alvo é o item). Usado no feed e na lista de amigos da obra:
 * mesmas tabelas e mesmas funções do banco (0018), nada duplicado.
 */
export function InteracaoDoItem({
  itemId,
  curti: curtiInicial,
  curtidas: curtidasIniciais,
  comentarios: comentariosIniciais,
}: {
  itemId: string
  curti: boolean
  curtidas: number
  comentarios: number
}) {
  const [curti, setCurti] = useState(curtiInicial)
  const [curtidas, setCurtidas] = useState(curtidasIniciais)
  const [totalComentarios, setTotalComentarios] = useState(comentariosIniciais)
  const [aberto, setAberto] = useState(false)
  const [comentarios, setComentarios] = useState<ComentarioDoFeed[] | null>(null)
  const [texto, setTexto] = useState('')
  const [pendente, startTransition] = useTransition()

  function alternarCurtir() {
    const proximo = !curti
    setCurti(proximo)
    setCurtidas((c) => Math.max(0, c + (proximo ? 1 : -1)))
    startTransition(async () => {
      try {
        desembrulhar(await alternarCurtida(itemId, proximo))
      } catch (e) {
        setCurti(!proximo)
        setCurtidas((c) => Math.max(0, c + (proximo ? -1 : 1)))
        toast.error(e instanceof Error ? e.message : 'Não foi possível curtir')
      }
    })
  }

  async function recarregar() {
    setComentarios(desembrulhar(await listarComentarios(itemId)))
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
        desembrulhar(await comentar(itemId, t))
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

  return (
    <>
      <div className="flex items-center gap-1 border-t border-border pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={alternarCurtir} aria-pressed={curti} aria-label={curti ? 'Descurtir' : 'Curtir'} className={cn(curti && 'text-destructive')}>
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
    </>
  )
}
