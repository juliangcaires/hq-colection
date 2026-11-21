'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Bell, BellOff, CheckCheck, Heart, MessageCircle, UserCheck, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { desembrulhar } from '@/lib/resultado'
import { tempoRelativo } from '@/lib/feed'
import { hrefDaNotificacao, TAMANHO_PAGINA_NOTIFICACOES, textoDaNotificacao, type Notificacao } from '@/lib/notificacoes'
import { maisNotificacoes, marcarNotificacoesLidas } from '@/app/(app)/notificacoes/actions'
import { useNotificacoes } from '@/components/shell/notificacoes-provider'

const ICONES: Record<string, typeof Bell> = {
  curtida: Heart,
  comentario: MessageCircle,
  amizade_pedido: UserPlus,
  amizade_aceita: UserCheck,
}

export function ListaDeNotificacoes({ iniciais, erro }: { iniciais: Notificacao[]; erro: boolean }) {
  const [itens, setItens] = useState(iniciais)
  const [temMais, setTemMais] = useState(iniciais.length >= TAMANHO_PAGINA_NOTIFICACOES)
  const [isPending, startTransition] = useTransition()
  const { atualizar } = useNotificacoes()
  const naoLidas = itens.filter((n) => !n.lida).length

  function marcarTodas() {
    startTransition(async () => {
      try {
        desembrulhar(await marcarNotificacoesLidas())
        setItens((l) => l.map((n) => ({ ...n, lida: true })))
        atualizar()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível marcar como lidas')
      }
    })
  }

  /** Abrir uma notificação a marca como lida; a navegação não espera. */
  function aoAbrir(n: Notificacao) {
    if (n.lida) return
    setItens((l) => l.map((x) => (x.id === n.id ? { ...x, lida: true } : x)))
    void marcarNotificacoesLidas([n.id]).then(atualizar)
  }

  function verMais() {
    const ultima = itens[itens.length - 1]
    if (!ultima) return
    startTransition(async () => {
      try {
        const mais = desembrulhar(await maisNotificacoes(ultima.criadoEm))
        setItens((l) => [...l, ...mais.filter((m) => !l.some((x) => x.id === m.id))])
        setTemMais(mais.length >= TAMANHO_PAGINA_NOTIFICACOES)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível carregar mais')
      }
    })
  }

  if (erro) {
    return (
      <p role="alert" className="rounded-2xl border border-destructive/40 bg-card p-4 text-sm text-foreground">
        Não foi possível carregar as notificações agora. Tente de novo em instantes.
      </p>
    )
  }

  if (itens.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card px-6 py-12 text-center">
        <BellOff className="size-8 text-muted-foreground" aria-hidden />
        <p className="font-medium text-foreground">Nenhuma notificação por aqui</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Quando um amigo curtir ou comentar uma leitura sua, ou pedir (ou aceitar) a sua amizade, avisamos aqui.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {naoLidas === 0 ? 'Tudo lido' : `${naoLidas} ${naoLidas === 1 ? 'não lida' : 'não lidas'}`}
        </p>
        <Button variant="outline" size="sm" onClick={marcarTodas} disabled={isPending || naoLidas === 0} className="gap-1.5">
          <CheckCheck className="size-4" aria-hidden />
          Marcar todas como lidas
        </Button>
      </div>
      <ul className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
        {itens.map((n) => {
          const Icone = ICONES[n.tipo] ?? Bell
          return (
            <li key={n.id} className="border-b border-border last:border-b-0">
              <Link
                href={hrefDaNotificacao(n)}
                onClick={() => aoAbrir(n)}
                className={cn('flex min-h-14 items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2', !n.lida && 'bg-primary/10')}
              >
                <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', n.lida ? 'bg-surface-2 text-muted-foreground' : 'bg-primary/20 text-foreground')}>
                  <Icone className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn('text-sm text-foreground', !n.lida && 'font-semibold')}>{textoDaNotificacao(n)}</span>
                  <span className="text-xs text-muted-foreground">{tempoRelativo(n.criadoEm)}</span>
                </span>
                {!n.lida && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="não lida" />}
              </Link>
            </li>
          )
        })}
      </ul>
      {temMais && (
        <Button variant="outline" onClick={verMais} disabled={isPending} className="self-center">
          Ver mais
        </Button>
      )}
    </div>
  )
}
