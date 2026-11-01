'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { OpcaoFilter } from '@/components/itens/opcao-filter'
import { TIPOS_TAG_DEDICADOS } from '@/lib/tags-por-tipo'
import type { TagLite, TipoObra, TipoTag } from '@/lib/types'

type SerieOpcao = { id: string; nome: string; tagIds: string[] }

const ESTADO_ITEMS = [
  { value: 'todos', label: 'Todos os estados' },
  { value: 'desejo', label: 'Desejo' },
  { value: 'comprado', label: 'Comprado' },
  { value: 'lido', label: 'Lido' },
]

const TIPO_OPCOES: { value: 'todos' | TipoObra; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'hq', label: 'HQ' },
  { value: 'manga', label: 'Mangá' },
]

const CHIP = 'h-11 shrink-0 rounded-full px-3.5 text-sm'

function idsDoParam(searchParams: URLSearchParams, key: string): string[] {
  const raw = searchParams.get(key)
  return raw ? raw.split(',').filter(Boolean) : []
}

export function ColecaoFilters({
  series,
  tags,
  mostrarEstado = true,
  mostrarAgrupar = true,
  mostrarSemCapa = true,
}: {
  series: SerieOpcao[]
  tags: TagLite[]
  mostrarEstado?: boolean
  mostrarAgrupar?: boolean
  mostrarSemCapa?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [busca, setBusca] = useState(searchParams.get('busca') ?? '')
  const [isPending, startTransition] = useTransition()

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if (busca !== (searchParams.get('busca') ?? '')) setParam('busca', busca || null)
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca])

  const agrupar = searchParams.get('agrupar') === '1'
  const semCapa = searchParams.get('capa') === 'sem'
  const editoraIds = idsDoParam(searchParams, 'editora')
  const editoraId = editoraIds[0]

  // Cascata: com uma editora escolhida, só as séries dela entram na lista.
  const seriesVisiveis = series.filter((s) => !editoraId || s.tagIds.includes(editoraId))
  const serieId = searchParams.get('serie')

  return (
    <div
      className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:rounded-[14px] lg:border lg:border-border lg:bg-card lg:p-3"
      aria-busy={isPending}
    >
      {/* A lista é renderizada no servidor: sem isto, filtrar parece não fazer nada até a resposta chegar. */}
      {isPending && (
        <div role="status" aria-label="Carregando" className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-primary" />
      )}
      <div className="relative lg:w-64">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          aria-label="Buscar por título"
          placeholder="Buscar por título..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="h-12 rounded-xl bg-surface-2 pl-10"
        />
      </div>

      <SegmentedControl
        ariaLabel="Tipo"
        options={TIPO_OPCOES}
        value={(searchParams.get('tipo') as TipoObra | null) ?? 'todos'}
        onChange={(v) => setParam('tipo', v === 'todos' ? null : v)}
        className="lg:w-64"
      />

      <div className="-mx-5 flex items-center gap-2 overflow-x-auto px-5 lg:mx-0 lg:contents lg:overflow-visible lg:px-0">
      {mostrarEstado && (
        <Select
          items={ESTADO_ITEMS}
          value={searchParams.get('estado') ?? 'todos'}
          onValueChange={(v) => setParam('estado', v === 'todos' ? null : v)}
        >
          <SelectTrigger className={cn(CHIP, "w-auto gap-2 border-border bg-card", searchParams.get('estado') && "border-primary bg-primary/15")}>
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            {ESTADO_ITEMS.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <OpcaoFilter
        label="Série"
        multiple={false}
        options={seriesVisiveis}
        selectedIds={serieId ? [serieId] : []}
        onChange={(ids) => setParam('serie', ids[0] ?? null)}
        limparLabel="Todas séries"
        // O nome sai da lista COMPLETA: se a cascata por editora esconder a série
        // escolhida, o filtro continua ativo e precisa continuar se identificando.
        nomeSelecionado={(id) => series.find((s) => s.id === id)?.nome}
      />

      {TIPOS_TAG_DEDICADOS.map(({ tipo, label, multiple }) => {
        const key = tipo as TipoTag
        const selectedIds = idsDoParam(searchParams, key)
        return (
          <OpcaoFilter
            key={key}
            label={label}
            multiple={multiple}
            options={tags.filter((t) => t.tipo === key)}
            selectedIds={selectedIds}
            onChange={(ids) => setParam(key, ids.length > 0 ? ids.join(',') : null)}
          />
        )
      })}

      {mostrarAgrupar && (
        <Button
          variant="outline"
          aria-pressed={agrupar}
          className={cn(CHIP, agrupar ? 'border-primary bg-primary/15' : 'bg-card')}
          onClick={() => setParam('agrupar', agrupar ? null : '1')}
        >
          Agrupar por série
        </Button>
      )}

      {mostrarSemCapa && (
        <Button
          variant="outline"
          aria-pressed={semCapa}
          className={cn(CHIP, semCapa ? 'border-primary bg-primary/15' : 'bg-card')}
          onClick={() => setParam('capa', semCapa ? null : 'sem')}
        >
          Sem capa
        </Button>
      )}

      <Button variant="ghost" className="h-11 shrink-0 rounded-full px-3.5 text-link" onClick={() => startTransition(() => router.push(pathname))}>
        Limpar filtros
      </Button>
      </div>
    </div>
  )
}
