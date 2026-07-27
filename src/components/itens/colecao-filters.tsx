'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Input } from '@/components/ui/input'
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

const TIPO_ITEMS = [
  { value: 'todos', label: 'HQ e mangá' },
  { value: 'hq', label: 'HQ' },
  { value: 'manga', label: 'Mangá' },
]

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
  const [, startTransition] = useTransition()

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
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
      <Input
        placeholder="Buscar por título..."
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        className="w-48"
      />

      {mostrarEstado && (
        <Select
          items={ESTADO_ITEMS}
          value={searchParams.get('estado') ?? 'todos'}
          onValueChange={(v) => setParam('estado', v === 'todos' ? null : v)}
        >
          <SelectTrigger className="w-36">
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

      <Select
        items={TIPO_ITEMS}
        value={searchParams.get('tipo') ?? 'todos'}
        onValueChange={(v) => setParam('tipo', v === 'todos' ? null : (v as TipoObra))}
      >
        <SelectTrigger className="w-32">
          <SelectValue placeholder="Tipo" />
        </SelectTrigger>
        <SelectContent>
          {TIPO_ITEMS.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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
          variant={agrupar ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setParam('agrupar', agrupar ? null : '1')}
        >
          Agrupar por série
        </Button>
      )}

      {mostrarSemCapa && (
        <Button
          variant={semCapa ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setParam('capa', semCapa ? null : 'sem')}
        >
          Sem capa
        </Button>
      )}

      <Button variant="ghost" size="sm" onClick={() => router.push(pathname)}>
        Limpar filtros
      </Button>
    </div>
  )
}
