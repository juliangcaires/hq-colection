'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { buscarSeries, createSerie } from '@/app/(app)/series/actions'
import { buscarTags } from '@/app/(app)/tags/actions'
import { createItem } from '@/app/(app)/itens/actions'
import type { TagLite, TipoObra } from '@/lib/types'

type SerieOption = {
  id: string
  nome: string
  tipo: TipoObra
  editora: string | null
  tags: TagLite[]
}

export function QuickAddForm({ onDone }: { onDone: () => void }) {
  const [serieOpen, setSerieOpen] = useState(false)
  const [serieQuery, setSerieQuery] = useState('')
  const [serieResults, setSerieResults] = useState<SerieOption[]>([])
  const [serieSelecionada, setSerieSelecionada] = useState<SerieOption | { novo: true; nome: string } | null>(
    null
  )

  const [numeroVolume, setNumeroVolume] = useState('')
  const [titulo, setTitulo] = useState('')
  const [prioridade, setPrioridade] = useState('0')

  const [tagOpen, setTagOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
  const [tagResults, setTagResults] = useState<TagLite[]>([])
  const [tagsExtras, setTagsExtras] = useState<TagLite[]>([])

  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const t = setTimeout(() => {
      buscarSeries(serieQuery).then(setSerieResults).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [serieQuery])

  useEffect(() => {
    const t = setTimeout(() => {
      buscarTags(tagQuery).then(setTagResults).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [tagQuery])

  const serieNomeExibido = serieSelecionada
    ? 'novo' in serieSelecionada
      ? `Criar série "${serieSelecionada.nome}"`
      : serieSelecionada.nome
    : 'Buscar série (opcional)...'

  const tagsHerdadas = serieSelecionada && !('novo' in serieSelecionada) ? serieSelecionada.tags : []

  function handleSubmit() {
    const tituloFinal =
      titulo.trim() ||
      (serieSelecionada
        ? `${'novo' in serieSelecionada ? serieSelecionada.nome : serieSelecionada.nome}${
            numeroVolume ? ` #${numeroVolume}` : ''
          }`
        : '')

    if (!tituloFinal) {
      toast.error('Escolha uma série ou preencha o título')
      return
    }

    startTransition(async () => {
      try {
        let serieId: string | null = null
        let tipo: TipoObra = 'hq'

        if (serieSelecionada && 'novo' in serieSelecionada) {
          serieId = await createSerie({
            nome: serieSelecionada.nome,
            tipo: 'hq',
            em_publicacao: true,
            tagIds: [],
          })
        } else if (serieSelecionada) {
          serieId = serieSelecionada.id
          tipo = serieSelecionada.tipo
        }

        await createItem({
          titulo: tituloFinal,
          serie_id: serieId,
          numero_volume: numeroVolume ? Number(numeroVolume) : null,
          tipo,
          estado: 'desejo',
          prioridade: Number(prioridade) || 0,
          tagIds: tagsExtras.map((t) => t.id),
        })

        toast.success('Adicionado à lista de desejos')
        onDone()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao adicionar item')
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Série</Label>
        <Popover open={serieOpen} onOpenChange={setSerieOpen}>
          <PopoverTrigger
            className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-start font-normal')}
          >
            {serieNomeExibido}
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Nome da série..."
                value={serieQuery}
                onValueChange={setSerieQuery}
              />
              <CommandList>
                <CommandEmpty>
                  {serieQuery.trim() ? (
                    <button
                      className="w-full px-2 py-1.5 text-left text-sm hover:text-neutral-100"
                      onClick={() => {
                        setSerieSelecionada({ novo: true, nome: serieQuery.trim() })
                        setSerieOpen(false)
                      }}
                    >
                      + Criar série &quot;{serieQuery.trim()}&quot;
                    </button>
                  ) : (
                    'Digite para buscar'
                  )}
                </CommandEmpty>
                <CommandGroup>
                  {serieResults.map((s) => (
                    <CommandItem
                      key={s.id}
                      value={s.id}
                      onSelect={() => {
                        setSerieSelecionada(s)
                        setSerieOpen(false)
                      }}
                    >
                      {s.nome}
                      {s.editora && <span className="ml-2 text-xs text-neutral-500">{s.editora}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {serieSelecionada && (
          <button
            type="button"
            className="self-start text-xs text-neutral-500 hover:text-neutral-300"
            onClick={() => setSerieSelecionada(null)}
          >
            limpar seleção
          </button>
        )}
        {tagsHerdadas.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            <span className="text-xs text-neutral-500">herda:</span>
            {tagsHerdadas.map((t) => (
              <Badge key={t.id} variant="secondary" className="text-xs">
                {t.nome}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="numero">Número / volume</Label>
          <Input
            id="numero"
            value={numeroVolume}
            onChange={(e) => setNumeroVolume(e.target.value)}
            placeholder="ex: 1"
            inputMode="decimal"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="prioridade">Prioridade</Label>
          <Input
            id="prioridade"
            type="number"
            value={prioridade}
            onChange={(e) => setPrioridade(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="titulo">
          Título {serieSelecionada && <span className="text-neutral-500">(opcional — gerado da série)</span>}
        </Label>
        <Input
          id="titulo"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder={serieSelecionada ? 'auto-gerado' : 'ex: Eternauta'}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Tags extras (específicas deste item)</Label>
        <Popover open={tagOpen} onOpenChange={setTagOpen}>
          <PopoverTrigger
            className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-start font-normal')}
          >
            {tagsExtras.length > 0 ? `${tagsExtras.length} selecionada(s)` : 'Adicionar tag...'}
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput placeholder="Buscar tag..." value={tagQuery} onValueChange={setTagQuery} />
              <CommandList>
                <CommandEmpty>Nenhuma tag encontrada</CommandEmpty>
                <CommandGroup>
                  {tagResults.map((t) => {
                    const jaSelecionada = tagsExtras.some((sel) => sel.id === t.id)
                    return (
                      <CommandItem
                        key={t.id}
                        value={t.id}
                        onSelect={() => {
                          setTagsExtras((prev) =>
                            jaSelecionada ? prev.filter((s) => s.id !== t.id) : [...prev, t]
                          )
                        }}
                      >
                        {jaSelecionada ? '✓ ' : ''}
                        {t.nome}
                        <span className="ml-2 text-xs text-neutral-500">{t.tipo}</span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {tagsExtras.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {tagsExtras.map((t) => (
              <Badge
                key={t.id}
                variant="outline"
                className="cursor-pointer text-xs"
                onClick={() => setTagsExtras((prev) => prev.filter((s) => s.id !== t.id))}
              >
                {t.nome} ×
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Button onClick={handleSubmit} disabled={isPending}>
        {isPending ? 'Salvando...' : 'Adicionar à lista de desejos'}
      </Button>
    </div>
  )
}
