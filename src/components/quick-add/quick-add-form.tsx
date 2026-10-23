'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { TagTypeCombobox } from '@/components/tags/tag-type-combobox'
import {
  analisarVolumes,
  CriarVolumesFields,
} from '@/components/series/criar-volumes-fields'
import {
  buscarSeries,
  createSerie,
  resumoVolumesDaSerie,
  type ResumoVolumesDaSerie,
} from '@/app/(app)/series/actions'
import { buscarTags } from '@/app/(app)/tags/actions'
import { createItem, criarVolumesEmLote } from '@/app/(app)/itens/actions'
import { buscarCapasEmLote } from '@/lib/capa-lote'
import type { EstadoItem, TagLite, TipoObra } from '@/lib/types'
import { desembrulhar } from '@/lib/resultado'
import { numeroInvalido, parseNumeroPtBr } from '@/lib/numeros'

const ESTADO_ITEMS = [
  { value: 'desejo', label: 'Desejo' },
  { value: 'comprado', label: 'Comprado' },
  { value: 'lido', label: 'Lido' },
]

const TIPO_ITEMS = [
  { value: 'hq', label: 'HQ' },
  { value: 'manga', label: 'Mangá' },
]

const ESTADO_LABEL_BOTAO: Record<EstadoItem, string> = {
  desejo: 'Adicionar à lista de desejos',
  comprado: 'Adicionar à coleção',
  lido: 'Adicionar à coleção',
}

const ESTADO_LABEL_TOAST: Record<EstadoItem, string> = {
  desejo: 'Adicionado à lista de desejos',
  comprado: 'Adicionado à coleção',
  lido: 'Adicionado à coleção',
}

type SerieOption = {
  id: string
  nome: string
  tipo: TipoObra
  tags: TagLite[]
}

export function QuickAddForm({ onDone }: { onDone: () => void }) {
  const router = useRouter()
  const [editoraSelecionada, setEditoraSelecionada] = useState<TagLite[]>([])

  const [serieOpen, setSerieOpen] = useState(false)
  const [serieQuery, setSerieQuery] = useState('')
  const [serieResults, setSerieResults] = useState<SerieOption[]>([])
  const [serieSelecionada, setSerieSelecionada] = useState<SerieOption | { novo: true; nome: string } | null>(
    null
  )

  const [numeroVolume, setNumeroVolume] = useState('')
  const [varios, setVarios] = useState(false)
  const [volumesTexto, setVolumesTexto] = useState('')
  const [resumoSerie, setResumoSerie] = useState<ResumoVolumesDaSerie | null>(null)
  const [titulo, setTitulo] = useState('')
  const [isbn, setIsbn] = useState('')
  const [prioridade, setPrioridade] = useState('0')
  const [estado, setEstado] = useState<EstadoItem>('desejo')
  const [tipoSelecionado, setTipoSelecionado] = useState<TipoObra>('hq')

  const [tagOpen, setTagOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
  const [tagResults, setTagResults] = useState<TagLite[]>([])
  const [tagsExtras, setTagsExtras] = useState<TagLite[]>([])

  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const t = setTimeout(() => {
      buscarSeries(serieQuery, editoraSelecionada[0]?.id).then(setSerieResults).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [serieQuery, editoraSelecionada])

  useEffect(() => {
    const t = setTimeout(() => {
      buscarTags(tagQuery).then(setTagResults).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [tagQuery])

  // O resumo só é buscado quando a caixinha é marcada — a maioria das inclusões
  // é de um volume só e não precisaria pagar por essa consulta.
  useEffect(() => {
    if (!varios || !serieSelecionada || 'novo' in serieSelecionada) return
    let ativo = true
    resumoVolumesDaSerie(serieSelecionada.id)
      .then((r) => {
        if (ativo) setResumoSerie(r)
      })
      .catch(() => {})
    return () => {
      ativo = false
    }
  }, [varios, serieSelecionada])

  /**
   * Trocar de série invalida tudo o que dependia da anterior: os furos, os
   * números já ocupados e a própria oferta do modo lote. Some daqui e não de um
   * efeito para não disparar uma re-renderização em cascata a cada seleção.
   */
  function selecionarSerie(nova: SerieOption | { novo: true; nome: string } | null) {
    setSerieSelecionada(nova)
    setVarios(false)
    setVolumesTexto('')
    setResumoSerie(null)
  }

  const serieNomeExibido = serieSelecionada
    ? 'novo' in serieSelecionada
      ? `Criar série "${serieSelecionada.nome}"`
      : serieSelecionada.nome
    : 'Buscar série (opcional)...'

  const tagsHerdadas = serieSelecionada && !('novo' in serieSelecionada) ? serieSelecionada.tags : []

  const analiseVolumes = analisarVolumes({
    texto: volumesTexto,
    numerosOcupados: resumoSerie?.numerosOcupados ?? [],
    temNumeracao: resumoSerie?.tem_numeracao ?? false,
  })

  /** Cria a série nova, se for o caso, e devolve o id para o fluxo seguir. */
  async function resolverSerieId(): Promise<{ serieId: string | null; tipo: TipoObra }> {
    if (serieSelecionada && 'novo' in serieSelecionada) {
      const id = desembrulhar(await createSerie({
        nome: serieSelecionada.nome,
        tipo: tipoSelecionado,
        em_publicacao: true,
        // Liga-se depois, na tela da série — exigir número aqui travaria a inclusão rápida.
        tem_numeracao: false,
        tagIds: editoraSelecionada.map((t) => t.id),
      }))
      return { serieId: id, tipo: tipoSelecionado }
    }
    if (serieSelecionada) return { serieId: serieSelecionada.id, tipo: serieSelecionada.tipo }
    return { serieId: null, tipo: tipoSelecionado }
  }

  function handleSubmitVarios() {
    if (analiseVolumes.bloqueado) return
    startTransition(async () => {
      try {
        const { serieId } = await resolverSerieId()
        if (!serieId) throw new Error('Escolha uma série para adicionar vários volumes')

        const resumo = desembrulhar(await criarVolumesEmLote({
          serieId,
          numeros: analiseVolumes.numeros,
          estado,
          prioridade: Number(prioridade) || 0,
          tagIds: tagsExtras.map((t) => t.id),
        }))

        toast.success(`${resumo.criados.length} volume(s) adicionados`)
        if (resumo.ignorados.length > 0) {
          toast.warning(`Já existiam na série: ${resumo.ignorados.map((n) => `#${n}`).join(', ')}`)
        }
        onDone()

        // Depois de fechar: a capa é acessório e a cascata de provedores é lenta.
        if (resumo.criados.length > 0) {
          const aplicadas = await buscarCapasEmLote(resumo.criados)
          if (aplicadas > 0) {
            toast.success(`Capa encontrada para ${aplicadas} de ${resumo.criados.length}`)
            router.refresh()
          }
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao adicionar volumes')
      }
    })
  }

  function handleSubmit() {
    if (varios) return handleSubmitVarios()

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
    if (numeroInvalido(numeroVolume)) {
      toast.error('Número do volume inválido')
      return
    }

    startTransition(async () => {
      try {
        const { serieId, tipo } = await resolverSerieId()

        const itemId = desembrulhar(await createItem({
          titulo: tituloFinal,
          serie_id: serieId,
          numero_volume: parseNumeroPtBr(numeroVolume),
          tipo,
          isbn: isbn.trim() || null,
          estado,
          prioridade: Number(prioridade) || 0,
          tagIds: tagsExtras.map((t) => t.id),
        }))

        // Busca de capa — a resposta agora é lida: candidatos não são mais
        // descartados em silêncio quando não há ISBN.
        try {
          const res = await fetch('/api/capa/buscar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId, isbn: isbn.trim() || null, titulo: tituloFinal, tipo }),
          })
          const data: { status?: string } = await res.json()
          if (data.status === 'aplicada') {
            toast.success(`${ESTADO_LABEL_TOAST[estado]} — capa encontrada automaticamente`)
          } else if (data.status === 'candidatos') {
            toast.success(ESTADO_LABEL_TOAST[estado], {
              description: 'Encontrei possíveis capas',
              action: {
                label: 'Escolher capa',
                onClick: () => router.push(`/item/${itemId}`),
              },
            })
          } else {
            toast.success(ESTADO_LABEL_TOAST[estado])
          }
        } catch {
          toast.success(ESTADO_LABEL_TOAST[estado])
        }
        onDone()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao adicionar item')
      }
    })
  }

  // Tipo só é escolhido manualmente quando não há série existente selecionada
  // (série já traz o tipo dela); ao criar série nova, o tipo escolhido aqui é o dela.
  const tipoEditavel = !serieSelecionada || 'novo' in serieSelecionada

  return (
    <div className="flex flex-col gap-4">
      <TagTypeCombobox
        tipo="editora"
        label="Editora"
        multiple={false}
        value={editoraSelecionada}
        onChange={setEditoraSelecionada}
        placeholder="Buscar editora (opcional)..."
      />

      <div className="flex flex-col gap-1.5">
        <Label>
          Série {editoraSelecionada.length > 0 && <span className="text-neutral-500">(dessa editora)</span>}
        </Label>
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
                        selecionarSerie({ novo: true, nome: serieQuery.trim() })
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
                        selecionarSerie(s)
                        setSerieOpen(false)
                      }}
                    >
                      {s.nome}
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
            onClick={() => selecionarSerie(null)}
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
          <Label>Estado</Label>
          <Select items={ESTADO_ITEMS} value={estado} onValueChange={(v) => setEstado(v as EstadoItem)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ESTADO_ITEMS.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {tipoEditavel && (
          <div className="flex flex-col gap-1.5">
            <Label>Tipo</Label>
            <Select
              items={TIPO_ITEMS}
              value={tipoSelecionado}
              onValueChange={(v) => setTipoSelecionado(v as TipoObra)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPO_ITEMS.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {serieSelecionada && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={varios} onCheckedChange={(v) => setVarios(v === true)} />
          Comprei mais de um volume desta série
        </label>
      )}

      {varios ? (
        <>
          <CriarVolumesFields
            id="quick-add-volumes"
            texto={volumesTexto}
            onTextoChange={setVolumesTexto}
            analise={analiseVolumes}
            faltantes={resumoSerie?.faltantes ?? []}
            temNumeracao={resumoSerie?.tem_numeracao ?? false}
            disabled={isPending}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prioridade">Prioridade</Label>
            <Input
              id="prioridade"
              type="number"
              value={prioridade}
              onChange={(e) => setPrioridade(e.target.value)}
            />
          </div>
        </>
      ) : (
        <>
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

          {/* Título e ISBN só existem no singular: no lote o título sai de "Série #n"
              e um ISBN valeria para um volume só. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="titulo">
              Título{' '}
              {serieSelecionada && (
                <span className="text-neutral-500">(opcional — gerado da série)</span>
              )}
            </Label>
            <Input
              id="titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={serieSelecionada ? 'auto-gerado' : 'ex: Eternauta'}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="isbn">
              ISBN{' '}
              <span className="text-neutral-500">
                (opcional — melhora a chance de achar a capa sozinho)
              </span>
            </Label>
            <Input
              id="isbn"
              value={isbn}
              onChange={(e) => setIsbn(e.target.value)}
              placeholder="ex: 9788545..."
            />
          </div>
        </>
      )}

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

      <Button onClick={handleSubmit} disabled={isPending || (varios && analiseVolumes.bloqueado)}>
        {isPending
          ? 'Salvando...'
          : varios
            ? `${ESTADO_LABEL_BOTAO[estado]} (${analiseVolumes.numeros.length} volumes)`
            : ESTADO_LABEL_BOTAO[estado]}
      </Button>
    </div>
  )
}
