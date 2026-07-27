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
  adicionarItensASerie,
  buscarItensParaSerie,
  type ItemCandidato,
} from '@/app/(app)/series/actions'

export function AdicionarVolumesDialog({
  serieId,
  serieNome,
}: {
  serieId: string
  serieNome: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [incluirComSerie, setIncluirComSerie] = useState(false)
  const [candidatos, setCandidatos] = useState<ItemCandidato[]>([])
  const [truncado, setTruncado] = useState(false)
  const [carregando, setCarregando] = useState(false)
  /** Guarda o item inteiro (não só o id) para o rodapé continuar contando e avisando
   *  mesmo depois que a busca mudar e a linha sair da lista visível. */
  const [selecionados, setSelecionados] = useState<Map<string, ItemCandidato>>(new Map())
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setCarregando(true)
      buscarItensParaSerie(serieId, query, incluirComSerie)
        .then((r) => {
          setCandidatos(r.itens)
          setTruncado(r.truncado)
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : 'Erro ao buscar itens'))
        .finally(() => setCarregando(false))
    }, 250)
    return () => clearTimeout(t)
  }, [open, query, incluirComSerie, serieId])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setQuery('')
      setIncluirComSerie(false)
      setSelecionados(new Map())
      setCandidatos([])
    }
  }

  function toggle(item: ItemCandidato) {
    setSelecionados((prev) => {
      const next = new Map(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.set(item.id, item)
      return next
    })
  }

  function marcarVisiveis() {
    setSelecionados((prev) => {
      const next = new Map(prev)
      for (const item of candidatos) next.set(item.id, item)
      return next
    })
  }

  const total = selecionados.size
  const movidos = Array.from(selecionados.values()).filter((i) => i.serie !== null)

  function handleIncluir() {
    if (total === 0) return
    const ids = Array.from(selecionados.keys())
    startTransition(async () => {
      try {
        const resumo = await adicionarItensASerie(serieId, ids)
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
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Buscar por título..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="max-w-xs flex-1"
            />
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
                {incluirComSerie
                  ? 'Nenhum item encontrado.'
                  : 'Nenhum item avulso encontrado. Ligue "mostrar itens de outras séries" para mover volumes de outra coleção.'}
              </p>
            )}
            {candidatos.map((item) => {
              const marcado = selecionados.has(item.id)
              return (
                <div
                  key={item.id}
                  onClick={() => toggle(item)}
                  className={`flex cursor-pointer items-center gap-3 p-2 transition-colors hover:bg-muted/50 ${
                    marcado ? 'bg-muted/40' : ''
                  }`}
                >
                  <Checkbox
                    checked={marcado}
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
              {Array.from(new Set(movidos.map((i) => i.serie!.nome))).join(', ')}.
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">{total} selecionado(s)</span>
            <Button onClick={handleIncluir} disabled={total === 0 || isPending}>
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
