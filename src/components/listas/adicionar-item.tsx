'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TipoBadge } from '@/components/ui/tipo-badge'
import { adicionarItem, buscarItensParaLista, type ItemParaAdicionar } from '@/app/(app)/listas/actions'
import { tituloDoItemDaLista } from '@/lib/listas'
import { desembrulhar } from '@/lib/resultado'

/** Busca na própria coleção (por título ou série) e adiciona o volume ao fim da lista. */
export function AdicionarItem({ listaId, cheia }: { listaId: string; cheia: boolean }) {
  const router = useRouter()
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<ItemParaAdicionar[] | null>(null)
  const [pendente, startTransition] = useTransition()

  function buscar(e: React.FormEvent) {
    e.preventDefault()
    if (termo.trim().length < 2) return
    startTransition(async () => {
      try {
        setResultados(desembrulhar(await buscarItensParaLista(listaId, termo)))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Não foi possível buscar')
      }
    })
  }

  function adicionar(item: ItemParaAdicionar) {
    startTransition(async () => {
      try {
        desembrulhar(await adicionarItem(listaId, item.id))
        setResultados((r) => r?.map((x) => (x.id === item.id ? { ...x, jaNaLista: true } : x)) ?? null)
        toast.success('Adicionado à lista')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Não foi possível adicionar')
      }
    })
  }

  if (cheia) return <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">Esta lista chegou ao limite de 200 itens.</p>

  return (
    <section aria-label="Adicionar itens" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <h2 className="font-heading text-base font-bold">Adicionar da sua coleção</h2>
      <form onSubmit={buscar} className="flex gap-2">
        <Input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Título ou série" aria-label="Buscar na sua coleção" maxLength={80} />
        <Button type="submit" size="icon-lg" disabled={pendente || termo.trim().length < 2} aria-label="Buscar">
          <Search aria-hidden />
        </Button>
      </form>
      {resultados && resultados.length === 0 && <p className="text-sm text-muted-foreground">Nada encontrado na sua coleção.</p>}
      {resultados && resultados.length > 0 && (
        <ul className="flex flex-col gap-2">
          {resultados.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl bg-surface-2 p-2">
              <div className="relative h-12 w-8 shrink-0 overflow-hidden rounded bg-card">
                {r.capa && <Image unoptimized src={r.capa} alt="" fill sizes="32px" className="object-cover" />}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium break-words text-foreground">{tituloDoItemDaLista(r)}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TipoBadge tipo={r.tipo} /> {r.estado === 'lido' ? 'Lido' : r.estado === 'comprado' ? 'Comprado' : 'Desejo'}
                </span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => adicionar(r)} disabled={pendente || r.jaNaLista} aria-label={`Adicionar ${tituloDoItemDaLista(r)}`}>
                {r.jaNaLista ? 'Na lista' : (
                  <>
                    <Plus aria-hidden /> Adicionar
                  </>
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
