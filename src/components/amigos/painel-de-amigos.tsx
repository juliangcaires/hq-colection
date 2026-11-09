'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Copy, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SeletorDeSecoes } from '@/components/configuracoes/seletor-de-secoes'
import {
  atualizarEscopoDosAmigos,
  desfazerAmizade,
  gerarConvite,
  responderAmizade,
  solicitarAmizade,
} from '@/app/(app)/amigos/actions'
import type { SecaoCompartilhavel } from '@/lib/compartilhamento'
import { desembrulhar } from '@/lib/resultado'

export type LinhaDeAmizade = {
  amizade_id: string
  status: 'pendente' | 'aceita'
  direcao: 'amigo' | 'enviada' | 'recebida'
  apelido: string | null
  nome_exibicao: string | null
}

const nomeDe = (a: LinhaDeAmizade) => a.nome_exibicao || a.apelido || 'Alguém'

/** Lista de amigos, pedidos, convite por link e escopo que os amigos veem. */
export function PainelDeAmigos({
  amizades,
  escopoInicial,
  temApelido,
}: {
  amizades: LinhaDeAmizade[]
  escopoInicial: SecaoCompartilhavel[]
  temApelido: boolean
}) {
  const router = useRouter()
  const [apelido, setApelido] = useState('')
  const [convite, setConvite] = useState<string | null>(null)
  const [escopo, setEscopo] = useState<SecaoCompartilhavel[]>(escopoInicial)
  const [salvo, setSalvo] = useState<SecaoCompartilhavel[]>(escopoInicial)
  const [desfazendo, setDesfazendo] = useState<LinhaDeAmizade | null>(null)
  const [isPending, startTransition] = useTransition()

  const recebidos = amizades.filter((a) => a.direcao === 'recebida')
  const enviados = amizades.filter((a) => a.direcao === 'enviada')
  const amigos = amizades.filter((a) => a.direcao === 'amigo')
  const escopoMudou = [...escopo].sort().join() !== [...salvo].sort().join()

  function executarAcao(fn: () => Promise<unknown>, sucesso: string) {
    startTransition(async () => {
      try {
        await fn()
        toast.success(sucesso)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Algo deu errado')
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {!temApelido && (
        <div role="alert" className="rounded-xl border border-warning/45 bg-warning/10 p-4 text-sm text-warning-text">
          Para adicionar amigos você precisa de um apelido.{' '}
          <Link href="/configuracoes" className="font-medium underline underline-offset-2">
            Definir meu apelido
          </Link>
        </div>
      )}

      {recebidos.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Pedidos recebidos">
          <h2 className="font-heading text-lg font-bold">Pedidos de amizade</h2>
          <ul className="flex flex-col gap-2">
            {recebidos.map((a) => (
              <li key={a.amizade_id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{nomeDe(a)}{a.apelido ? <span className="text-muted-foreground"> @{a.apelido}</span> : null}</span>
                <Button className="h-10 gap-1.5" disabled={isPending} onClick={() => executarAcao(async () => desembrulhar(await responderAmizade(a.amizade_id, true)), 'Amizade aceita')}>
                  <Check className="size-4" aria-hidden />
                  Aceitar
                </Button>
                <Button variant="outline" className="h-10 gap-1.5" disabled={isPending} onClick={() => executarAcao(async () => desembrulhar(await responderAmizade(a.amizade_id, false)), 'Pedido recusado')}>
                  <X className="size-4" aria-hidden />
                  Recusar
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-[18px]" aria-label="Adicionar amigo">
        <h2 className="font-heading text-lg font-bold">Adicionar um amigo</h2>
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            executarAcao(async () => {
              desembrulhar(await solicitarAmizade(apelido))
              setApelido('')
            }, 'Pedido enviado. Ele só vale quando a outra pessoa aceitar.')
          }}
        >
          <Label htmlFor="apelido-amigo">Apelido da pessoa</Label>
          <div className="flex gap-2">
            <Input id="apelido-amigo" className="h-11 rounded-[10px] bg-surface-2" value={apelido} onChange={(e) => setApelido(e.target.value)} placeholder="ex: maria_hq" maxLength={30} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            <Button type="submit" className="h-11 shrink-0 gap-2" disabled={isPending || !apelido.trim() || !temApelido}>
              <UserPlus className="size-4" aria-hidden />
              Pedir
            </Button>
          </div>
        </form>

        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <p className="text-sm text-muted-foreground">Ou mande um link de convite (vale por 7 dias e para uma pessoa só):</p>
          {convite ? (
            <div className="flex gap-2">
              <Input readOnly aria-label="Link de convite" className="h-11 rounded-[10px] bg-surface-2 font-mono text-xs" value={`${typeof window !== 'undefined' ? window.location.origin : ''}/amigos/convite/${convite}`} onFocus={(e) => e.currentTarget.select()} />
              <Button
                variant="outline"
                className="h-11 shrink-0 gap-2"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`${window.location.origin}/amigos/convite/${convite}`)
                    toast.success('Convite copiado')
                  } catch {
                    toast.error('Não consegui copiar. Selecione o endereço e copie à mão.')
                  }
                }}
              >
                <Copy className="size-4" aria-hidden />
                Copiar
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              className="h-11 w-fit"
              disabled={isPending || !temApelido}
              onClick={() => executarAcao(async () => setConvite(desembrulhar(await gerarConvite())), 'Convite criado')}
            >
              Gerar link de convite
            </Button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-label="Meus amigos">
        <h2 className="font-heading text-lg font-bold">Meus amigos {amigos.length > 0 && <span className="text-sm font-normal text-muted-foreground">({amigos.length})</span>}</h2>
        {amigos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ainda não há amigos aceitos.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {amigos.map((a) => (
              <li key={a.amizade_id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <Link href={`/amigos/${a.apelido}`} className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{nomeDe(a)}</span>
                  {a.apelido && <span className="truncate text-xs text-muted-foreground">@{a.apelido}</span>}
                </Link>
                <Button variant="ghost" className="h-10 text-danger-soft-text" disabled={isPending} onClick={() => setDesfazendo(a)}>
                  Desfazer
                </Button>
              </li>
            ))}
          </ul>
        )}
        {enviados.length > 0 && (
          <div className="flex flex-col gap-2 pt-2">
            <h3 className="text-sm font-medium text-muted-foreground">Pedidos enviados (aguardando aceite)</h3>
            <ul className="flex flex-col gap-2">
              {enviados.map((a) => (
                <li key={a.amizade_id} className="flex items-center gap-3 rounded-xl border border-dashed border-border p-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{nomeDe(a)}</span>
                  <Button variant="ghost" className="h-10" disabled={isPending} onClick={() => executarAcao(async () => desembrulhar(await desfazerAmizade(a.amizade_id)), 'Pedido cancelado')}>
                    Cancelar
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-[18px]" aria-label="O que os amigos veem">
        <h2 className="font-heading text-lg font-bold">O que meus amigos veem</h2>
        <p className="text-sm text-muted-foreground">Vale só para amigos aceitos e é separado do link público. Preço, loja e data de compra nunca aparecem.</p>
        <SeletorDeSecoes valor={escopo} onChange={setEscopo} disabled={isPending} idBase="amigos" />
        {escopoMudou && (
          <Button
            className="h-11 w-fit"
            disabled={isPending || escopo.length === 0}
            onClick={() =>
              executarAcao(async () => {
                desembrulhar(await atualizarEscopoDosAmigos(escopo))
                setSalvo(escopo)
              }, 'Seções atualizadas')
            }
          >
            Salvar seções
          </Button>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(desfazendo)}
        onOpenChange={(v) => !v && setDesfazendo(null)}
        title={`Desfazer a amizade com ${desfazendo ? nomeDe(desfazendo) : ''}?`}
        description="Vocês deixam de ver a coleção um do outro na hora. Presentes marcados entre vocês são apagados."
        confirmLabel="Desfazer"
        isPending={isPending}
        onConfirm={() => {
          const alvo = desfazendo
          setDesfazendo(null)
          if (alvo) executarAcao(async () => desembrulhar(await desfazerAmizade(alvo.amizade_id)), 'Amizade desfeita')
        }}
      />
    </div>
  )
}
