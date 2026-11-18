'use client'

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, Layers, Search, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { FilterChip } from '@/components/ui/filter-chip'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ORDENS_DESEJOS, type OrdemDesejos } from '@/lib/desejos-agrupados'
import { TIPOS_TAG_DEDICADOS } from '@/lib/tags-por-tipo'
import { cn } from '@/lib/utils'
import type { TagLite, TipoObra } from '@/lib/types'

type SerieOpcao = { id: string; nome: string; tagIds: string[] }
type Opcao = { id: string; nome: string }

/** Um tipo de filtro do menu: `serie` + os tipos de tag. `param` é a chave na URL. */
type TipoDeFiltro = { param: string; label: string; multiple: boolean; opcoes: Opcao[] }

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

/**
 * Barra de filtros de Desejos: busca, Todos/HQ/Mangá, menu "Filtros" (série, tags e "Sem capa"),
 * ordenação, "Agrupar por série" e, no fim, o que a tela encaixar (o botão "Selecionar").
 * Tudo mora na URL; os chips dos filtros ativos aparecem logo abaixo.
 */
export function DesejosFiltros({
  series,
  tags,
  ordem,
  agrupar,
  totalSeries,
  selecionar,
}: {
  series: SerieOpcao[]
  tags: TagLite[]
  ordem: OrdemDesejos
  agrupar: boolean
  /** Quantas séries (fora "Avulsos") o modo agrupado mostra — vai para o aviso de leitor de tela. */
  totalSeries: number
  selecionar?: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [busca, setBusca] = useState(searchParams.get('busca') ?? '')
  const [menuAberto, setMenuAberto] = useState(false)
  const [tipoAberto, setTipoAberto] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function navegar(params: URLSearchParams) {
    // Mudou o recorte: a paginação ("carregar mais") recomeça.
    params.delete('limite')
    const qs = params.toString()
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname))
  }

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    navegar(params)
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if (busca !== (searchParams.get('busca') ?? '')) setParam('busca', busca || null)
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca])

  const semCapa = searchParams.get('capa') === 'sem'
  const editoraId = idsDoParam(searchParams, 'editora')[0]

  // Cascata: com uma editora escolhida, só as séries dela entram na lista.
  const seriesVisiveis = series.filter((s) => !editoraId || s.tagIds.includes(editoraId))

  const tipos: TipoDeFiltro[] = [
    { param: 'serie', label: 'Série', multiple: false, opcoes: seriesVisiveis },
    ...TIPOS_TAG_DEDICADOS.map(({ tipo, label, multiple }) => ({
      param: tipo as string,
      label,
      multiple,
      opcoes: tags.filter((t) => t.tipo === tipo),
    })),
  ]

  function nomeDe(tipo: TipoDeFiltro, id: string): string {
    // A série escolhida pode estar fora da lista por causa da cascata: o nome sai da lista completa.
    const lista = tipo.param === 'serie' ? series : tipo.opcoes
    return lista.find((o) => o.id === id)?.nome ?? '…'
  }

  const ativos = tipos.flatMap((t) => idsDoParam(searchParams, t.param).map((id) => ({ tipo: t, id })))
  const totalAtivos = ativos.length + (semCapa ? 1 : 0)
  const temFiltroAtivo = totalAtivos > 0 || Boolean(searchParams.get('busca')) || Boolean(searchParams.get('tipo'))

  function alternarOpcao(tipo: TipoDeFiltro, id: string) {
    const atuais = idsDoParam(searchParams, tipo.param)
    const marcado = atuais.includes(id)
    const proximos = tipo.multiple ? (marcado ? atuais.filter((x) => x !== id) : [...atuais, id]) : marcado ? [] : [id]
    setParam(tipo.param, proximos.length > 0 ? proximos.join(',') : null)
  }

  function removerAtivo(tipo: TipoDeFiltro, id: string) {
    const restantes = idsDoParam(searchParams, tipo.param).filter((x) => x !== id)
    setParam(tipo.param, restantes.length > 0 ? restantes.join(',') : null)
  }

  function limparFiltros() {
    const params = new URLSearchParams()
    // Modo e ordenação são da tela, não filtros: sobrevivem ao "limpar".
    if (agrupar) params.set('agrupar', 'serie')
    if (ordem !== 'prioridade') params.set('ordem', ordem)
    setBusca('')
    navegar(params)
  }

  const tipoDoMenu = tipos.find((t) => t.param === tipoAberto) ?? null
  const ordemItems = ORDENS_DESEJOS.map((o) => ({ value: o.valor, label: o.label }))

  return (
    <div className="flex flex-col gap-3" aria-busy={isPending}>
      {/* A lista vem do servidor: sem isto, filtrar parece não fazer nada até a resposta chegar. */}
      {isPending && (
        <div role="status" aria-label="Carregando" className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-primary" />
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {agrupar
          ? `Agrupado por série · ${totalSeries} ${totalSeries === 1 ? 'série' : 'séries'}`
          : 'Exibindo em grade'}
      </p>

      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-border bg-card p-2.5">
        <div className="relative min-w-0 flex-1 basis-60">
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
            className="h-11 rounded-[10px] bg-surface-2 pl-10"
          />
        </div>

        <SegmentedControl
          ariaLabel="Tipo"
          options={TIPO_OPCOES}
          value={(searchParams.get('tipo') as TipoObra | null) ?? 'todos'}
          onChange={(v) => setParam('tipo', v === 'todos' ? null : v)}
          className="h-11 gap-0.5 rounded-[10px] bg-background p-0.5 sm:w-60"
        />

        <Popover open={menuAberto} onOpenChange={setMenuAberto}>
          <PopoverTrigger
            className={cn(
              CHIP,
              'inline-flex items-center gap-2 border font-normal transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              totalAtivos > 0 ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card text-foreground'
            )}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            {totalAtivos > 0 ? `Filtros · ${totalAtivos}` : 'Filtros'}
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] gap-3 p-3">
            <div className="flex flex-wrap gap-2">
              {tipos
                .filter((t) => t.opcoes.length > 0 || idsDoParam(searchParams, t.param).length > 0)
                .map((t) => {
                  const n = idsDoParam(searchParams, t.param).length
                  const aberto = tipoAberto === t.param
                  return (
                    <button
                      key={t.param}
                      type="button"
                      aria-pressed={aberto}
                      onClick={() => setTipoAberto(aberto ? null : t.param)}
                      className={cn(
                        'h-11 rounded-full border px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        aberto || n > 0 ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card text-foreground'
                      )}
                    >
                      {t.label}
                      {n > 0 && <span className="text-link"> · {n}</span>}
                    </button>
                  )
                })}
              <button
                type="button"
                aria-pressed={semCapa}
                onClick={() => setParam('capa', semCapa ? null : 'sem')}
                className={cn(
                  'h-11 rounded-full border px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  semCapa ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card text-foreground'
                )}
              >
                Sem capa
              </button>
            </div>

            {tipoDoMenu && (
              <Command className="border border-border">
                <CommandInput placeholder={`Buscar ${tipoDoMenu.label.toLowerCase()}...`} />
                <CommandList>
                  <CommandEmpty>Nada encontrado</CommandEmpty>
                  <CommandGroup>
                    {tipoDoMenu.opcoes.map((o) => {
                      const marcado = idsDoParam(searchParams, tipoDoMenu.param).includes(o.id)
                      return (
                        <CommandItem key={o.id} value={o.nome} onSelect={() => alternarOpcao(tipoDoMenu, o.id)}>
                          {marcado ? '✓ ' : ''}
                          {o.nome}
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            )}
          </PopoverContent>
        </Popover>

        <Select
          items={ordemItems}
          value={ordem}
          onValueChange={(v) => setParam('ordem', v === 'prioridade' ? null : v)}
        >
          <SelectTrigger aria-label="Ordenar" className={cn(CHIP, 'w-auto gap-2 border-border bg-card')}>
            <span className="text-muted-foreground">Ordenar:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORDENS_DESEJOS.map((o) => (
              <SelectItem key={o.valor} value={o.valor}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          aria-pressed={agrupar}
          className={cn(CHIP, 'gap-2', agrupar ? 'border-primary bg-primary/15 text-foreground' : 'bg-card')}
          onClick={() => setParam('agrupar', agrupar ? null : 'serie')}
        >
          <Layers className="size-4" aria-hidden />
          Agrupar por série
        </Button>

        {selecionar}
      </div>

      {temFiltroAtivo && (
        <div className="flex flex-wrap items-center gap-2">
          {ativos.map(({ tipo, id }) => (
            <FilterChip
              key={`${tipo.param}:${id}`}
              label={tipo.label}
              valor={nomeDe(tipo, id)}
              onClear={() => removerAtivo(tipo, id)}
            />
          ))}
          {semCapa && <FilterChip label="Capa" valor="sem capa" onClear={() => setParam('capa', null)} />}
          <Button variant="ghost" className="h-11 shrink-0 rounded-full px-3.5 text-link" onClick={limparFiltros}>
            Limpar filtros
          </Button>
        </div>
      )}
    </div>
  )
}
