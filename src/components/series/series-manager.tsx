'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TipoBadge } from '@/components/ui/tipo-badge'
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
  const [filtroTipo, setFiltroTipo] = useState<'todos' | TipoObra>('todos')
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

  const visiveis = filtroTipo === 'todos' ? series : series.filter((s) => s.tipo === filtroTipo)

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
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Nova série</label>
          <Input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            placeholder="Nome"
            className="h-11 w-48 rounded-xl bg-surface-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Tipo</label>
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

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-72">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Buscar série"
            placeholder="Buscar série..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-12 rounded-xl bg-surface-2 pl-10"
          />
        </div>
        <SegmentedControl
          ariaLabel="Tipo"
          value={filtroTipo}
          onChange={setFiltroTipo}
          options={[
            { value: 'todos', label: 'Todas' },
            { value: 'hq', label: 'HQ' },
            { value: 'manga', label: 'Mangá' },
          ]}
          className="lg:w-64"
        />
      </div>

      {visiveis.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma série encontrada.</p>}
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
        {visiveis.map((s) => (
          <li key={s.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            <Link href={`/serie/${s.id}`} className="flex min-h-14 min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-sm font-semibold text-foreground">{s.nome}</span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <TipoBadge tipo={s.tipo} />
                {s.total_volumes ? `${s.total_volumes} volumes` : null}
                {!s.em_publicacao && <Badge variant="secondary">encerrada</Badge>}
                {s.completa && <Badge variant="sucesso">completa</Badge>}
                {s.lida && <Badge variant="sucesso">lida</Badge>}
                {s.faltantes.length > 0 && (
                  <span className="rounded bg-warning px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                    {s.faltantes.length} {s.faltantes.length === 1 ? 'furo' : 'furos'}
                  </span>
                )}
              </span>
            </Link>
            <Button
              variant="ghost"
              className="size-11 p-0 text-danger-text"
              aria-label={`Excluir ${s.nome}`}
              onClick={() => setDeletando(s)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>

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
