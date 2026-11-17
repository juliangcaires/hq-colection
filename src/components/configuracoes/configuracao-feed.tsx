'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { definirFeedAtivo } from '@/app/(app)/feed/actions'
import { desembrulhar } from '@/lib/resultado'

/** Interruptor geral do feed de amigos. Desligado por padrão: nada é compartilhado até a pessoa ligar. */
export function ConfiguracaoFeed({ ativoInicial }: { ativoInicial: boolean }) {
  const [ativo, setAtivo] = useState(ativoInicial)
  const [isPending, startTransition] = useTransition()

  function alterar(valor: boolean) {
    const anterior = ativo
    setAtivo(valor)
    startTransition(async () => {
      try {
        desembrulhar(await definirFeedAtivo(valor))
        toast.success(valor ? 'Suas leituras agora aparecem no feed dos amigos' : 'Suas leituras saíram do feed dos amigos')
      } catch (e) {
        setAtivo(anterior)
        toast.error(e instanceof Error ? e.message : 'Não foi possível salvar')
      }
    })
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-[18px]">
      <h2 className="font-heading text-[19px] font-bold">Feed de amigos</h2>
      <p className="text-sm text-muted-foreground">
        Com o feed ligado, cada leitura que você marcar aparece para os seus amigos aceitos, com a capa, a nota e a crítica.
        Eles podem curtir e comentar. Só amigos veem; ninguém mais.
      </p>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-2 p-3">
        <Checkbox className="mt-0.5" checked={ativo} disabled={isPending} onCheckedChange={(v) => alterar(v === true)} aria-describedby="feed-ativo-texto" />
        <span className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Compartilhar minhas leituras com os amigos</span>
          <span id="feed-ativo-texto" className="text-xs text-muted-foreground">
            Desligado por padrão. Ao ligar, seus amigos também passam a ver suas notas e críticas (em &quot;Amigos&quot;, a seção
            Notas e críticas é ligada junto). Crítica marcada como privada nunca aparece. Leituras marcadas antes de ligar
            não entram no feed. Desligue quando quiser: o feed some na hora, e você pode tirar um post específico pelo próprio feed.
          </span>
        </span>
      </label>
    </section>
  )
}
