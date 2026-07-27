'use client'

import { useEffect, useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { OpcaoFilter } from '@/components/itens/opcao-filter'
import { TIPOS_TAG_DEDICADOS } from '@/lib/tags-por-tipo'
import {
  adicionarItensASerie,
  buscarItensParaSerie,
  type ItemCandidato,
} from '@/app/(app)/series/actions'
import type { TagLite, TipoObra, TipoTag } from '@/lib/types'

const TIPO_ITEMS = [
  { value: 'todos', label: 'HQ e mangá' },
  { value: 'hq', label: 'HQ' },
  { value: 'manga', label: 'Mangá' },
]

/** Aceita vírgula como separador decimal (1,5) — a coluna é numeric de propósito. */
function parseNumero(bruto: string): number | null {
  const limpo = bruto.trim().replace(',', '.')
  if (!limpo) return null
  const n = Number(limpo)
  return Number.isFinite(n) ? n : null
}

type Selecionado = { item: ItemCandidato; numero: string }

export function AdicionarVolumesDialog({
  serieId,
  serieNome,
  temNumeracao,
  numerosOcupados,
  tags,
}: {
  serieId: string
  serieNome: string
  temNumeracao: boolean
  /** Números já usados por volumes desta série — nenhum deles pode ser candidato,
   *  já que a busca nunca lista itens que já estão nela. */
  numerosOcupados: number[]
  tags: TagLite[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [incluirComSerie, setIncluirComSerie] = useState(false)
  const [tipoFiltro, setTipoFiltro] = useState<TipoObra | 'todos'>('todos')
  const [tagsPorTipo, setTagsPorTipo] = useState<Partial<Record<TipoTag, string[]>>>({})
  const [candidatos, setCandidatos] = useState<ItemCandidato[]>([])
  const [truncado, setTruncado] = useState(false)
  const [carregando, setCarregando] = useState(false)
  /** Guarda o item inteiro (não só o id) para o rodapé continuar contando e avisando
   *  mesmo depois que a busca mudar e a linha sair da lista visível. */
  const [selecionados, setSelecionados] = useState<Map<string, Selecionado>>(new Map())
  const [isPending, startTransition] = useTransition()

  const filtroDeTagAtivo = Object.values(tagsPorTipo).some((ids) => ids && ids.length > 0)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setCarregando(true)
      buscarItensParaSerie({
        serieId,
        query,
        incluirComSerie,
        tipo: tipoFiltro === 'todos' ? undefined : tipoFiltro,
        tagsPorTipo,
      })
        .then((r) => {
          setCandidatos(r.itens)
          setTruncado(r.truncado)
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : 'Erro ao buscar itens'))
        .finally(() => setCarregando(false))
    }, 250)
    return () => clearTimeout(t)
  }, [open, query, incluirComSerie, tipoFiltro, tagsPorTipo, serieId])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setQuery('')
      setIncluirComSerie(false)
      setTipoFiltro('todos')
      setTagsPorTipo({})
      setSelecionados(new Map())
      setCandidatos([])
    }
  }

  function toggle(item: ItemCandidato) {
    setSelecionados((prev) => {
      const next = new Map(prev)
      if (next.has(item.id)) next.delete(item.id)
      // Já numerado na coleção? Aproveita o número em vez de fazer redigitar.
      else next.set(item.id, { item, numero: item.numero_volume?.toString() ?? '' })
      return next
    })
  }

  function setNumero(itemId: string, numero: string) {
    setSelecionados((prev) => {
      const atual = prev.get(itemId)
      if (!atual) return prev
      const next = new Map(prev)
      next.set(itemId, { ...atual, numero })
      return next
    })
  }

  function marcarVisiveis() {
    setSelecionados((prev) => {
      const next = new Map(prev)
      for (const item of candidatos) {
        if (!next.has(item.id)) {
          next.set(item.id, { item, numero: item.numero_volume?.toString() ?? '' })
        }
      }
      return next
    })
  }

  const entradas = Array.from(selecionados.values())
  const total = entradas.length
  const movidos = entradas.filter(({ item }) => item.serie !== null)

  // Validação da numeração: espelha a que roda no servidor, para bloquear antes
  // de gastar a ida e mostrar exatamente qual linha está errada.
  const semNumero = new Set<string>()
  const emConflito = new Set<string>()
  if (temNumeracao) {
    const ocupados = new Set(numerosOcupados)
    const contagem = new Map<number, number>()
    for (const { numero } of entradas) {
      const n = parseNumero(numero)
      if (n !== null) contagem.set(n, (contagem.get(n) ?? 0) + 1)
    }
    for (const { item, numero } of entradas) {
      const n = parseNumero(numero)
      if (n === null) semNumero.add(item.id)
      else if ((contagem.get(n) ?? 0) > 1 || ocupados.has(n)) emConflito.add(item.id)
    }
  }

  const bloqueado = semNumero.size > 0 || emConflito.size > 0
  // O item problemático pode ter saído da lista visível quando a busca mudou —
  // sem nomear os pendentes o usuário fica com o botão travado sem saber por quê.
  const pendentes = entradas.filter(({ item }) => semNumero.has(item.id) || emConflito.has(item.id))

  function handleIncluir() {
    if (total === 0 || bloqueado) return
    const payload = entradas.map(({ item, numero }) => ({
      itemId: item.id,
      numero: temNumeracao ? parseNumero(numero) : null,
    }))
    startTransition(async () => {
      try {
        const resumo = await adicionarItensASerie(serieId, payload)
        if (resumo.incluidos > 0) {
          toast.success(`${resumo.incluidos} volume(s) incluídos em "${serieNome}"`)
        }
        if (resumo.ignorados > 0) {
          toast.error(`${resumo.ignorados} item(ns) não puderam ser incluídos`)
        }
        if (resumo.volumesDuplicados.length > 0) {
          toast.warning(
            `Atenção: número de volume repetido na série — ${resumo.volumesDuplicados.join(', ')}`
          )
        }
        handleOpenChange(false)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao incluir volumes')
      }
    })
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Adicionar volumes
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Adicionar volumes a &ldquo;{serieNome}&rdquo;</DialogTitle>
            <DialogDescription>
              Marque os itens da sua coleção que pertencem a esta série. A seleção é mantida
              enquanto você busca.
              {temNumeracao && ' Esta série é numerada: informe o número de cada volume marcado.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Buscar por título..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-44"
            />

            <Select
              items={TIPO_ITEMS}
              value={tipoFiltro}
              onValueChange={(v) => setTipoFiltro(v as TipoObra | 'todos')}
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

            {TIPOS_TAG_DEDICADOS.map(({ tipo, label, multiple }) => {
              const key = tipo as TipoTag
              return (
                <OpcaoFilter
                  key={key}
                  label={label}
                  multiple={multiple}
                  options={tags.filter((t) => t.tipo === key)}
                  selectedIds={tagsPorTipo[key] ?? []}
                  onChange={(ids) =>
                    setTagsPorTipo((prev) => ({ ...prev, [key]: ids.length > 0 ? ids : undefined }))
                  }
                />
              )
            })}

            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={incluirComSerie}
                onCheckedChange={(checked) => setIncluirComSerie(Boolean(checked))}
              />
              Mostrar itens de outras séries
            </label>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {carregando ? 'Buscando...' : `${candidatos.length} item(ns)`}
              {truncado ? ' — lista truncada, refine a busca' : ''}
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={marcarVisiveis} disabled={candidatos.length === 0}>
                Marcar visíveis
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelecionados(new Map())}
                disabled={total === 0}
              >
                Limpar
              </Button>
            </div>
          </div>

          <div className="flex max-h-[50vh] flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {!carregando && candidatos.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                {filtroDeTagAtivo
                  ? 'Nenhum item com essas tags. Itens avulsos não herdam as tags da série, então muitos não têm tag nenhuma — desligue o filtro de tag para vê-los.'
                  : incluirComSerie
                    ? 'Nenhum item encontrado.'
                    : 'Nenhum item avulso encontrado. Ligue "mostrar itens de outras séries" para mover volumes de outra coleção.'}
              </p>
            )}
            {candidatos.map((item) => {
              const marcado = selecionados.get(item.id)
              const invalido = semNumero.has(item.id) || emConflito.has(item.id)
              return (
                <div
                  key={item.id}
                  onClick={() => toggle(item)}
                  className={`flex cursor-pointer items-center gap-3 p-2 transition-colors hover:bg-muted/50 ${
                    marcado ? 'bg-muted/40' : ''
                  }`}
                >
                  <Checkbox
                    checked={Boolean(marcado)}
                    onCheckedChange={() => toggle(item)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Selecionar ${item.titulo}`}
                  />
                  <div className="relative h-12 w-8 shrink-0 overflow-hidden rounded bg-card ring-1 ring-border">
                    {item.capaUrl && (
                      <Image src={item.capaUrl} alt="" fill sizes="32px" className="object-cover" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-foreground">
                      {item.titulo}
                      {item.numero_volume !== null ? ` #${item.numero_volume}` : ''}
                    </span>
                    {item.serie ? (
                      <span className="truncate text-xs text-amber-400">
                        em &ldquo;{item.serie.nome}&rdquo; — será movido
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">sem série</span>
                    )}
                  </div>
                  {temNumeracao && marcado && (
                    <Input
                      value={marcado.numero}
                      onChange={(e) => setNumero(item.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      inputMode="decimal"
                      placeholder="nº"
                      aria-label={`Número de ${item.titulo} na série`}
                      aria-invalid={invalido}
                      className={`w-20 shrink-0 ${invalido ? 'border-destructive' : ''}`}
                    />
                  )}
                  {item.estado === 'desejo' && (
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      desejo
                    </Badge>
                  )}
                </div>
              )
            })}
          </div>

          {movidos.length > 0 && (
            <p className="rounded-lg border border-amber-900 bg-amber-950/40 p-2 text-xs text-amber-300">
              {movidos.length} dos selecionados serão movidos de outra série:{' '}
              {Array.from(new Set(movidos.map(({ item }) => item.serie!.nome))).join(', ')}.
            </p>
          )}

          {bloqueado && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
              <p className="font-medium">
                {semNumero.size > 0 && `${semNumero.size} volume(s) sem número`}
                {semNumero.size > 0 && emConflito.size > 0 && ' · '}
                {emConflito.size > 0 && `${emConflito.size} com número repetido`}
              </p>
              <p className="mt-1">
                {pendentes
                  .slice(0, 5)
                  .map(({ item }) => item.titulo)
                  .join(', ')}
                {pendentes.length > 5 ? ` e mais ${pendentes.length - 5}` : ''}
              </p>
              {query && (
                <button
                  type="button"
                  className="mt-1 underline hover:no-underline"
                  onClick={() => setQuery('')}
                >
                  Limpar a busca para encontrá-los
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">{total} selecionado(s)</span>
            <Button onClick={handleIncluir} disabled={total === 0 || bloqueado || isPending}>
              {isPending
                ? 'Incluindo...'
                : movidos.length > 0
                  ? `Incluir e mover (${total})`
                  : `Incluir na série (${total})`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
