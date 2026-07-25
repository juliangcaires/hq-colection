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
import type { TagLite, TipoObra } from '@/lib/types'

type SerieOpcao = { id: string; nome: string }

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

export function ColecaoFilters({
  editoras,
  series,
  tags,
  mostrarEstado = true,
  mostrarAgrupar = true,
}: {
  editoras: string[]
  series: SerieOpcao[]
  tags: TagLite[]
  mostrarEstado?: boolean
  mostrarAgrupar?: boolean
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

  const editoraItems = [
    { value: 'todas', label: 'Todas editoras' },
    ...editoras.map((e) => ({ value: e, label: e })),
  ]
  const serieItems = [
    { value: 'todas', label: 'Todas séries' },
    ...series.map((s) => ({ value: s.id, label: s.nome })),
  ]
  const tagItems = [
    { value: 'todas', label: 'Todas tags' },
    ...tags.map((t) => ({ value: t.id, label: t.nome })),
  ]

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
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

      <Select
        items={editoraItems}
        value={searchParams.get('editora') ?? 'todas'}
        onValueChange={(v) => setParam('editora', v === 'todas' ? null : v)}
      >
        <SelectTrigger className="w-36">
          <SelectValue placeholder="Editora" />
        </SelectTrigger>
        <SelectContent>
          {editoraItems.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        items={serieItems}
        value={searchParams.get('serie') ?? 'todas'}
        onValueChange={(v) => setParam('serie', v === 'todas' ? null : v)}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Série" />
        </SelectTrigger>
        <SelectContent>
          {serieItems.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        items={tagItems}
        value={searchParams.get('tag') ?? 'todas'}
        onValueChange={(v) => setParam('tag', v === 'todas' ? null : v)}
      >
        <SelectTrigger className="w-36">
          <SelectValue placeholder="Tag" />
        </SelectTrigger>
        <SelectContent>
          {tagItems.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {mostrarAgrupar && (
        <Button
          variant={agrupar ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setParam('agrupar', agrupar ? null : '1')}
        >
          Agrupar por série
        </Button>
      )}

      <Button variant="ghost" size="sm" onClick={() => router.push(pathname)}>
        Limpar filtros
      </Button>
    </div>
  )
}
