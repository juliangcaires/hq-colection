'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createSerie,
  deleteSerie,
  listarSeries,
  type SerieListada,
} from '@/app/(app)/series/actions'
import type { TipoObra } from '@/lib/types'
import { desembrulhar } from '@/lib/resultado'

type SerieRow = SerieListada

const TIPO_ITEMS = [
  { value: 'hq', label: 'HQ' },
  { value: 'manga', label: 'Mangá' },
]

export function SeriesManager({ initialSeries }: { initialSeries: SerieRow[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [series, setSeries] = useState(initialSeries)
  const [novoNome, setNovoNome] = useState('')
  const [novoTipo, setNovoTipo] = useState<TipoObra>('hq')
  const [isPending, startTransition] = useTransition()
  const [deletando, setDeletando] = useState<SerieRow | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      listarSeries(query)
        .then(setSeries)
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  function handleCreate() {
    if (!novoNome.trim()) return
    startTransition(async () => {
      try {
        const id = desembrulhar(await createSerie({
          nome: novoNome.trim(),
          tipo: novoTipo,
          em_publicacao: true,
          tem_numeracao: false,
          tagIds: [],
        }))
        toast.success('Série criada')
        router.push(`/serie/${id}`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao criar série')
      }
    })
  }

  function handleDelete() {
    if (!deletando) return
    startTransition(async () => {
      try {
        desembrulhar(await deleteSerie(deletando.id))
        setSeries((prev) => prev.filter((s) => s.id !== deletando.id))
        toast.success('Série excluída')
        setDeletando(null)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao excluir')
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-400">Nova série</label>
          <Input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            placeholder="Nome"
            className="w-48"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-400">Tipo</label>
          <Select items={TIPO_ITEMS} value={novoTipo} onValueChange={(v) => v && setNovoTipo(v as TipoObra)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPO_ITEMS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleCreate} disabled={isPending || !novoNome.trim()}>
          Criar
        </Button>
      </div>

      <Input
        placeholder="Buscar série..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-xs"
      />

      <div className="flex flex-col divide-y divide-neutral-800 rounded-lg border border-neutral-800">
        {series.length === 0 && <p className="p-4 text-sm text-neutral-500">Nenhuma série encontrada.</p>}
        {series.map((s) => (
          <div key={s.id} className="flex items-center gap-3 p-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <Link href={`/serie/${s.id}`} className="truncate text-sm font-medium hover:underline">
                {s.nome}
              </Link>
              <span className="text-xs text-neutral-500">
                {s.tipo === 'manga' ? 'Mangá' : 'HQ'}
                {s.total_volumes ? ` · ${s.total_volumes} volumes` : ''}
              </span>
            </div>
            {!s.em_publicacao && (
              <Badge variant="secondary" className="text-xs">
                encerrada
              </Badge>
            )}
            {s.completa && (
              <Badge variant="sucesso" className="text-xs">
                completa
              </Badge>
            )}
            <Link href={`/serie/${s.id}`} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
              Editar
            </Link>
            <Button size="sm" variant="ghost" className="text-red-400" onClick={() => setDeletando(s)}>
              Excluir
            </Button>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(deletando)}
        onOpenChange={(open) => !open && setDeletando(null)}
        title={`Excluir a série "${deletando?.nome}"?`}
        description="Os itens ficam avulsos (não são excluídos)."
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        isPending={isPending}
      />
    </div>
  )
}
