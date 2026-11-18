'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Check, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { CriticaSpoiler } from '@/components/ui/critica-spoiler'
import { Textarea } from '@/components/ui/textarea'
import { TipoBadge } from '@/components/ui/tipo-badge'
import { editarItem, removerItem, reordenarItens } from '@/app/(app)/listas/actions'
import { MAX_NOTA_DO_ITEM, moverItem, situacaoDoItem, tituloDoItemDaLista, urlDeCapaDaLista, type ItemDaLista } from '@/lib/listas'
import { desembrulhar } from '@/lib/resultado'
import { cn } from '@/lib/utils'

const SITUACAO = {
  lido: { texto: 'Você leu', classe: 'bg-success/15 text-success-text' },
  tenho: { texto: 'Você tem', classe: 'bg-primary/15 text-link' },
  nao_tenho: { texto: 'Você não tem', classe: 'bg-surface-2 text-muted-foreground' },
} as const

/**
 * Itens da lista. Para o dono: reordenar (botões subir/descer, sem arrastar, para funcionar no celular e no teclado),
 * editar o comentário e o spoiler, remover. Para um amigo: o comentário (com `CriticaSpoiler`) e se ele tem/leu a obra.
 * Todo texto entra como texto puro.
 */
export function ItensDaLista({ listaId, ordenada, proprio, itens: iniciais }: { listaId: string; ordenada: boolean; proprio: boolean; itens: ItemDaLista[] }) {
  const router = useRouter()
  const [itens, setItens] = useState(iniciais)
  const [editando, setEditando] = useState<string | null>(null)
  const [nota, setNota] = useState('')
  const [spoiler, setSpoiler] = useState(false)
  const [pendente, startTransition] = useTransition()

  // O servidor é a fonte da ordem: depois de `router.refresh()` chegam itens novos.
  const [versao, setVersao] = useState(iniciais)
  if (versao !== iniciais) {
    setVersao(iniciais)
    setItens(iniciais)
  }

  function mover(de: number, para: number) {
    const anterior = itens
    const proxima = moverItem(itens, de, para)
    setItens(proxima)
    startTransition(async () => {
      try {
        desembrulhar(await reordenarItens(listaId, proxima.map((i) => i.id)))
        router.refresh()
      } catch (err) {
        setItens(anterior)
        toast.error(err instanceof Error ? err.message : 'Não foi possível reordenar')
      }
    })
  }

  function remover(id: string) {
    startTransition(async () => {
      try {
        desembrulhar(await removerItem(listaId, id))
        setItens((l) => l.filter((i) => i.id !== id))
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Não foi possível remover')
      }
    })
  }

  function abrirEdicao(item: ItemDaLista) {
    setEditando(item.id)
    setNota(item.nota ?? '')
    setSpoiler(item.spoiler)
  }

  function salvarEdicao(id: string) {
    startTransition(async () => {
      try {
        desembrulhar(await editarItem(listaId, id, nota.trim() || null, spoiler))
        setEditando(null)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Não foi possível salvar')
      }
    })
  }

  if (itens.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {proprio ? 'A lista está vazia. Busque um volume da sua coleção abaixo para começar.' : 'Esta lista ainda não tem itens.'}
      </p>
    )
  }

  return (
    <ol className="flex flex-col gap-2">
      {itens.map((item, i) => {
        const capa = urlDeCapaDaLista(item.capa, item.id)
        const situacao = SITUACAO[situacaoDoItem(item)]
        return (
          <li key={item.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
            <div className="flex gap-3">
              {ordenada && <span className="w-6 shrink-0 pt-1 text-right font-heading text-lg font-extrabold text-muted-foreground tabular-nums">{i + 1}</span>}
              <div className="relative h-[84px] w-14 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                {capa && <Image unoptimized src={capa} alt="" fill sizes="56px" className="object-cover" />}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <h3 className="font-heading text-base leading-tight font-bold break-words text-foreground">{tituloDoItemDaLista(item)}</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <TipoBadge tipo={item.tipo} />
                  {!proprio && <span className={cn('rounded-4xl px-2 py-0.5 text-xs font-medium', situacao.classe)}>{situacao.texto}</span>}
                </div>
                {item.nota && editando !== item.id && <CriticaSpoiler texto={item.nota} spoiler={item.spoiler} proprio={proprio} />}
              </div>
              {proprio && (
                <div className="flex shrink-0 flex-col gap-1">
                  {ordenada && (
                    <>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => mover(i, i - 1)} disabled={pendente || i === 0} aria-label={`Subir ${tituloDoItemDaLista(item)}`}>
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => mover(i, i + 1)} disabled={pendente || i === itens.length - 1} aria-label={`Descer ${tituloDoItemDaLista(item)}`}>
                        <ArrowDown aria-hidden />
                      </Button>
                    </>
                  )}
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => abrirEdicao(item)} disabled={pendente} aria-label={`Editar comentário de ${tituloDoItemDaLista(item)}`}>
                    <Pencil aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => remover(item.id)} disabled={pendente} aria-label={`Tirar ${tituloDoItemDaLista(item)} da lista`}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              )}
            </div>
            {proprio && editando === item.id && (
              <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
                <Textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={MAX_NOTA_DO_ITEM} rows={2} placeholder="Um comentário curto sobre este item (opcional)" aria-label="Comentário do item" />
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <Checkbox checked={spoiler} onCheckedChange={(v) => setSpoiler(v === true)} disabled={!nota.trim()} />
                  Contém spoiler (os amigos veem o comentário recolhido)
                </label>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => salvarEdicao(item.id)} disabled={pendente}>
                    <Check aria-hidden /> Salvar
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditando(null)} disabled={pendente}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
