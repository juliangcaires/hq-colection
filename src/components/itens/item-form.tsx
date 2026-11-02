'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Layers } from 'lucide-react'
import { Estrelas } from '@/components/ui/estrelas'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { BackButton } from '@/components/ui/back-button'
import { TagTypeCombobox } from '@/components/tags/tag-type-combobox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  aplicarCapaEscolhida,
  createItem,
  deleteItem,
  updateItem,
  uploadCapaManual,
} from '@/app/(app)/itens/actions'
import { agruparTagsPorTipo, TIPOS_TAG_DEDICADOS } from '@/lib/tags-por-tipo'
import type { EstadoItem, ItemComRelacoes, TagLite, TipoObra, TipoTag } from '@/lib/types'
import { descreverFalhaProvedor, type CandidatoCapa, type ResultadoProvedor } from '@/lib/capa-busca'
import { desembrulhar } from '@/lib/resultado'
import { numeroInvalido, parseNumeroPtBr } from '@/lib/numeros'

type SerieOpcao = { id: string; nome: string }

export function ItemForm({
  item,
  capaUrl,
  series,
}: {
  item?: ItemComRelacoes
  capaUrl: string | null
  series: SerieOpcao[]
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [titulo, setTitulo] = useState(item?.titulo ?? '')
  const [serieId, setSerieId] = useState<string>(item?.serie?.id ?? '')
  const [numeroVolume, setNumeroVolume] = useState(item?.numero_volume?.toString() ?? '')
  const [tipo, setTipo] = useState<TipoObra>(item?.tipo ?? 'hq')
  const [isbn, setIsbn] = useState(item?.isbn ?? '')
  const [estado, setEstado] = useState<EstadoItem>(item?.estado ?? 'desejo')
  const [prioridade, setPrioridade] = useState(item?.prioridade?.toString() ?? '0')
  const [preco, setPreco] = useState(item?.preco?.toString() ?? '')
  const [loja, setLoja] = useState(item?.loja ?? '')
  const [dataAquisicao, setDataAquisicao] = useState(item?.data_aquisicao ?? '')
  const [nota, setNota] = useState<number | null>(item?.nota ?? null)
  const [critica, setCritica] = useState(item?.critica ?? '')
  const [tagsPorTipo, setTagsPorTipo] = useState<Record<TipoTag, TagLite[]>>(() =>
    agruparTagsPorTipo(
      (item?.tagsItem ?? []).map((t) => t.id),
      item?.tagsItem ?? []
    )
  )

  const [isPending, startTransition] = useTransition()
  const [isUploading, startUpload] = useTransition()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [buscandoCapa, setBuscandoCapa] = useState(false)
  const [candidatos, setCandidatos] = useState<CandidatoCapa[] | null>(null)
  const [aplicandoCandidato, startAplicarCandidato] = useTransition()

  const tagsHerdadas = item?.tagsSerie ?? []

  function handleSave() {
    if (!titulo.trim()) {
      toast.error('Título obrigatório')
      return
    }
    if (numeroInvalido(numeroVolume) || numeroInvalido(preco)) {
      toast.error(numeroInvalido(numeroVolume) ? 'Número do volume inválido' : 'Preço inválido')
      return
    }
    startTransition(async () => {
      try {
        const input = {
          titulo: titulo.trim(),
          serie_id: serieId || null,
          numero_volume: parseNumeroPtBr(numeroVolume),
          tipo,
          isbn: isbn || null,
          estado,
          prioridade: Number(prioridade) || 0,
          preco: parseNumeroPtBr(preco),
          loja: loja || null,
          data_aquisicao: dataAquisicao || null,
          nota: nota,
          critica: critica || null,
          tagIds: Object.values(tagsPorTipo).flatMap((tags) => tags.map((t) => t.id)),
        }
        if (item) {
          desembrulhar(await updateItem(item.id, input))
          toast.success('Item atualizado')
        } else {
          const id = desembrulhar(await createItem(input))
          toast.success('Item criado')
          router.push(`/item/${id}`)
          return
        }
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao salvar')
      }
    })
  }

  function handleDelete() {
    if (!item) return
    startTransition(async () => {
      try {
        desembrulhar(await deleteItem(item.id))
        toast.success('Item excluído')
        router.push('/colecao')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao excluir')
        setDeleteOpen(false)
      }
    })
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !item) return
    const formData = new FormData()
    formData.append('file', file)
    startUpload(async () => {
      try {
        desembrulhar(await uploadCapaManual(item.id, formData))
        toast.success('Capa atualizada')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao enviar capa')
      }
    })
  }

  async function handleBuscarCapaAutomatica() {
    if (!item) return
    setBuscandoCapa(true)
    setCandidatos(null)
    try {
      const res = await fetch('/api/capa/buscar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, isbn: isbn || null, titulo, tipo }),
      })
      const data: {
        status?: string
        error?: string
        candidatos?: CandidatoCapa[]
        diagnostico?: ResultadoProvedor[]
      } = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao buscar capa')
      } else if (data.status === 'aplicada') {
        toast.success('Capa encontrada e aplicada automaticamente')
        router.refresh()
      } else if (data.status === 'candidatos') {
        setCandidatos(data.candidatos ?? [])
      } else {
        const falhaFonte = data.diagnostico && descreverFalhaProvedor(data.diagnostico)
        if (falhaFonte) {
          toast.error(falhaFonte)
        } else {
          toast.info(
            'Nenhuma capa encontrada automaticamente — cobertura de edição brasileira é irregular. Envie uma foto.'
          )
        }
      }
    } catch {
      toast.error('Erro ao buscar capa')
    } finally {
      setBuscandoCapa(false)
    }
  }

  function handleEscolherCandidato(candidato: CandidatoCapa) {
    if (!item) return
    startAplicarCandidato(async () => {
      try {
        desembrulhar(await aplicarCapaEscolhida(item.id, candidato))
        toast.success('Capa aplicada')
        setCandidatos(null)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao aplicar capa')
      }
    })
  }

  return (
    <div className="flex flex-col gap-6 pb-16 lg:pb-0">
      <BackButton />

      <div className="flex flex-col items-center gap-4 lg:items-start">
        <div className="relative h-[252px] w-[168px] flex-shrink-0 shadow-xl shadow-black/40 lg:h-[420px] lg:w-[280px] overflow-hidden rounded-md bg-surface-2">
          {capaUrl ? (
            <Image unoptimized src={capaUrl} alt={titulo} fill sizes="112px" className="object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
              sem capa
            </div>
          )}
        </div>
        <div className="flex flex-col items-center gap-2 lg:items-start">
          {item && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleBuscarCapaAutomatica}
                disabled={buscandoCapa}
              >
                {buscandoCapa ? 'Buscando...' : 'Buscar capa automaticamente'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? 'Enviando...' : 'Enviar foto da capa'}
              </Button>
              <p className="max-w-56 text-xs text-muted-foreground">
                Cobertura automática de edição brasileira é irregular — enviar foto é normal, não erro.
              </p>
            </>
          )}
        </div>
      </div>

      {candidatos && candidatos.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
          <p className="text-sm text-foreground">
            Encontrei {candidatos.length} candidato(s) — escolha a capa certa:
          </p>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
            {candidatos.map((c, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${c.url}-${i}`}
                src={c.url}
                alt={c.label}
                title={c.label}
                onClick={() => handleEscolherCandidato(c)}
                className={`aspect-[2/3] cursor-pointer rounded border-2 border-transparent object-cover transition hover:border-primary ${
                  aplicandoCandidato ? 'pointer-events-none opacity-50' : ''
                }`}
              />
            ))}
          </div>
          <Button variant="ghost" size="sm" className="w-fit" onClick={() => setCandidatos(null)}>
            Cancelar
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="titulo">Título</Label>
        <Input className="h-12 rounded-xl bg-surface-2" id="titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>Série</Label>
          <Select
            items={[{ value: '__nenhuma__', label: 'Avulso (sem série)' }, ...series.map((s) => ({ value: s.id, label: s.nome }))]}
            value={serieId || '__nenhuma__'}
            onValueChange={(v) => setSerieId(v === '__nenhuma__' ? '' : v ?? '')}
          >
            <SelectTrigger className="h-12 w-full rounded-xl bg-surface-2">
              <SelectValue placeholder="Avulso" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__nenhuma__">Avulso (sem série)</SelectItem>
              {series.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {item?.serie && (
            <Link href={`/serie/${item.serie.id}`} className="text-xs text-muted-foreground hover:underline">
              Ver série
            </Link>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="numero">Número / volume</Label>
          <Input className="h-12 rounded-xl bg-surface-2" id="numero" value={numeroVolume} onChange={(e) => setNumeroVolume(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Estado</Label>
        <SegmentedControl<EstadoItem>
          ariaLabel="Estado"
          value={estado}
          onChange={setEstado}
          options={[
            { value: 'desejo', label: 'Desejo', activeClassName: 'bg-warning font-semibold text-primary-foreground' },
            { value: 'comprado', label: 'Comprado', activeClassName: 'bg-primary font-semibold text-primary-foreground' },
            { value: 'lido', label: 'Lido', activeClassName: 'bg-read font-semibold text-primary-foreground' },
          ]}
          className="[&_button]:h-11"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>Tipo</Label>
          <Select
            items={[
              { value: 'hq', label: 'HQ' },
              { value: 'manga', label: 'Mangá' },
            ]}
            value={tipo}
            onValueChange={(v) => v && setTipo(v as TipoObra)}
          >
            <SelectTrigger className="h-12 w-full rounded-xl bg-surface-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hq">HQ</SelectItem>
              <SelectItem value="manga">Mangá</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="prioridade">Prioridade</Label>
          <Input className="h-12 rounded-xl bg-surface-2" id="prioridade"
            type="number"
            value={prioridade}
            onChange={(e) => setPrioridade(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="isbn">ISBN</Label>
        <Input className="h-12 rounded-xl bg-surface-2" id="isbn" value={isbn} onChange={(e) => setIsbn(e.target.value)} />
      </div>

      {estado !== 'desejo' && (
        <div className="grid grid-cols-3 gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="preco">Preço</Label>
            <Input className="h-12 rounded-xl bg-surface-2" id="preco" type="number" step="0.01" value={preco} onChange={(e) => setPreco(e.target.value)} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="loja">Loja</Label>
            <Input className="h-12 rounded-xl bg-surface-2" id="loja" value={loja} onChange={(e) => setLoja(e.target.value)} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="data">Data aquisição</Label>
            <Input className="h-12 rounded-xl bg-surface-2" id="data"
              type="date"
              value={dataAquisicao ?? ''}
              onChange={(e) => setDataAquisicao(e.target.value)}
            />
          </div>
        </div>
      )}

      {estado === 'lido' && (
        <div className="flex flex-col gap-1.5">
          <Label>Nota</Label>
          <Estrelas valor={nota} onChange={setNota} />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="critica">Crítica</Label>
        <Textarea className="rounded-xl bg-surface-2" id="critica" value={critica} onChange={(e) => setCritica(e.target.value)} rows={3} placeholder="O que você achou da leitura?" />
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-3">
        {tagsHerdadas.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {tagsHerdadas.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-xs text-foreground"
                >
                  <Layers className="size-3" aria-hidden />
                  {t.nome}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Tags tracejadas são herdadas da série.</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Tags específicas deste item (além das herdadas da série)</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TIPOS_TAG_DEDICADOS.map(({ tipo: tipoTag, label, multiple }) => (
            <TagTypeCombobox
              key={tipoTag}
              tipo={tipoTag}
              label={label}
              multiple={multiple}
              value={tagsPorTipo[tipoTag]}
              onChange={(tags) => setTagsPorTipo((prev) => ({ ...prev, [tipoTag]: tags }))}
            />
          ))}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-3 border-t border-border bg-background/90 px-5 py-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:pt-2 lg:backdrop-blur-none">
        <Button className="h-12 flex-1 lg:h-11 lg:flex-none" onClick={handleSave} disabled={isPending}>
          {isPending ? 'Salvando...' : item ? 'Salvar alterações' : 'Criar item'}
        </Button>
        {item && (
          <Button variant="ghost" onClick={() => setDeleteOpen(true)} disabled={isPending} className="text-danger-text">
            Excluir item
          </Button>
        )}
      </div>

      {item && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={`Excluir "${item.titulo}"?`}
          description="Essa ação não pode ser desfeita."
          confirmLabel="Excluir"
          onConfirm={handleDelete}
          isPending={isPending}
        />
      )}
    </div>
  )
}
