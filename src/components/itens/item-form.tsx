'use client'

import { useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Check, ChevronDown, Layers, MoreHorizontal, Star, ArrowLeft, Minus, Plus } from 'lucide-react'
import { Estrelas } from '@/components/ui/estrelas'
import { formatarNota } from '@/lib/nota'
import { TipoBadge } from '@/components/ui/tipo-badge'
import { AdquirirDialog } from '@/components/itens/adquirir-button'
import { MarcarLidoDialog } from '@/components/itens/marcar-lido-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
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
  item: ItemComRelacoes
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

  const [adquirindo, setAdquirindo] = useState(false)
  const [avaliando, setAvaliando] = useState(false)
  const [dadosAberto, setDadosAberto] = useState(false)
  const [compraAberto, setCompraAberto] = useState(false)

  const tagsHerdadas = item?.tagsSerie ?? []

  // "Alterado" = qualquer campo diferente do que veio do banco. A página remonta o formulário quando
  // o item salvo muda (key), então o baseline acompanha o que foi salvo.
  const idsTags = (m: Record<TipoTag, TagLite[]>) => Object.values(m).flatMap((ts) => ts.map((t) => t.id).sort())
  const valoresAtuais = JSON.stringify([
    titulo, serieId, numeroVolume, tipo, isbn, estado, prioridade, preco, loja, dataAquisicao, nota, critica,
    idsTags(tagsPorTipo),
  ])
  const [valoresIniciais] = useState(valoresAtuais)
  const alterado = valoresAtuais !== valoresIniciais

  function descartar() {
    setTitulo(item.titulo)
    setSerieId(item.serie?.id ?? '')
    setNumeroVolume(item.numero_volume?.toString() ?? '')
    setTipo(item.tipo)
    setIsbn(item.isbn ?? '')
    setEstado(item.estado)
    setPrioridade(item.prioridade?.toString() ?? '0')
    setPreco(item.preco?.toString() ?? '')
    setLoja(item.loja ?? '')
    setDataAquisicao(item.data_aquisicao ?? '')
    setNota(item.nota ?? null)
    setCritica(item.critica ?? '')
    setTagsPorTipo(agruparTagsPorTipo(item.tagsItem.map((t) => t.id), item.tagsItem))
  }

  function handleSave() {
    if (!titulo.trim()) {
      setDadosAberto(true)
      toast.error('Título obrigatório')
      return
    }
    if (numeroInvalido(numeroVolume) || numeroInvalido(preco)) {
      // No mobile os cards ficam recolhidos: abre o que tem o campo com erro.
      if (numeroInvalido(numeroVolume)) setDadosAberto(true)
      else setCompraAberto(true)
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

  const desejo = estado === 'desejo'
  const comprado = estado === 'comprado'
  const lido = estado === 'lido'
  const precoNum = parseNumeroPtBr(preco)
  const brl = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
  const dataBr = dataAquisicao ? dataAquisicao.split('-').reverse().join('/') : '—'
  const resumo: { rotulo: string; valor: ReactNode; className?: string }[] = desejo
    ? [
        { rotulo: 'Estado', valor: 'Desejo', className: 'font-semibold text-warning-text' },
        { rotulo: 'Prioridade', valor: Number(prioridade) || 0, className: 'font-semibold' },
        { rotulo: 'Preço esperado', valor: brl(precoNum), className: 'font-semibold' },
        { rotulo: 'ISBN', valor: isbn || '—', className: 'tabular-nums' },
      ]
    : comprado
      ? [
          { rotulo: 'Estado', valor: 'Comprado', className: 'font-semibold text-link' },
          { rotulo: 'Adquirido', valor: dataBr },
          { rotulo: 'Pago', valor: brl(precoNum) },
          { rotulo: 'ISBN', valor: isbn || '—', className: 'tabular-nums' },
        ]
      : [
          { rotulo: 'Estado', valor: 'Lido', className: 'font-semibold text-danger-text' },
          { rotulo: 'Nota', valor: nota === null ? '—' : `★ ${formatarNota(nota)}`, className: 'font-semibold text-warning-text' },
          { rotulo: 'Adquirido', valor: dataBr },
          { rotulo: 'ISBN', valor: isbn || '—', className: 'tabular-nums' },
        ]

  const selo = desejo
    ? { texto: 'Desejo', className: 'bg-warning' }
    : comprado
      ? { texto: 'Na fila', className: 'bg-primary' }
      : { texto: 'Lido', className: 'bg-read' }

  const campoClasse = 'h-11 rounded-[10px] bg-surface-2'

  const campoTitulo = (
    <Campo rotulo="Título" id="titulo">
      <Input className={campoClasse} id="titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
    </Campo>
  )
  const campoSerie = (
    <Campo rotulo="Série">
      <Select
        items={[{ value: '__nenhuma__', label: 'Avulso (sem série)' }, ...series.map((s) => ({ value: s.id, label: s.nome }))]}
        value={serieId || '__nenhuma__'}
        onValueChange={(v) => setSerieId(v === '__nenhuma__' ? '' : v ?? '')}
      >
        <SelectTrigger className="h-11 w-full rounded-[10px] bg-surface-2">
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
      {item.serie && (
        <Link href={`/serie/${item.serie.id}`} className="text-xs text-link hover:underline">
          Ver série
        </Link>
      )}
    </Campo>
  )
  const campoNumero = (
    <Campo rotulo="Nº" id="numero">
      <Input className={campoClasse} id="numero" value={numeroVolume} onChange={(e) => setNumeroVolume(e.target.value)} />
    </Campo>
  )
  const campoTipo = (
    <Campo rotulo="Tipo">
      <Select
        items={[
          { value: 'hq', label: 'HQ' },
          { value: 'manga', label: 'Mangá' },
        ]}
        value={tipo}
        onValueChange={(v) => v && setTipo(v as TipoObra)}
      >
        <SelectTrigger className="h-11 w-full rounded-[10px] bg-surface-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="hq">HQ</SelectItem>
          <SelectItem value="manga">Mangá</SelectItem>
        </SelectContent>
      </Select>
    </Campo>
  )
  const campoIsbn = (
    <Campo rotulo="ISBN" id="isbn">
      <Input className={campoClasse} id="isbn" value={isbn} onChange={(e) => setIsbn(e.target.value)} />
    </Campo>
  )
  const campoPreco = (rotulo: string) => (
    <Campo rotulo={rotulo} id="preco">
      <Input className={campoClasse} id="preco" type="number" step="0.01" placeholder="0,00" value={preco} onChange={(e) => setPreco(e.target.value)} />
    </Campo>
  )
  const campoLoja = (rotulo: string, placeholder: string) => (
    <Campo rotulo={rotulo} id="loja">
      <Input className={campoClasse} id="loja" placeholder={placeholder} value={loja} onChange={(e) => setLoja(e.target.value)} />
    </Campo>
  )

  const cardDados = (
    <CardSecao titulo="Dados" aberto={dadosAberto} onAbertoChange={setDadosAberto} className={desejo ? 'lg:col-span-full' : undefined}>
      {desejo ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          {campoTitulo}
          {campoSerie}
          {campoNumero}
          {campoTipo}
          {campoIsbn}
        </div>
      ) : (
        <>
          {campoTitulo}
          <div className="grid grid-cols-[2fr_1fr] gap-2.5">
            {campoSerie}
            {campoNumero}
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-2.5">
            {campoTipo}
            {campoIsbn}
          </div>
        </>
      )}
    </CardSecao>
  )

  const cardCompra = (
    <CardSecao titulo="Compra" aberto={compraAberto} onAbertoChange={setCompraAberto}>
      <div className="grid grid-cols-2 gap-2.5">
        {campoPreco(comprado ? 'Preço pago' : 'Preço')}
        <Campo rotulo="Data de aquisição" id="data">
          <Input className={campoClasse} id="data" type="date" value={dataAquisicao} onChange={(e) => setDataAquisicao(e.target.value)} />
        </Campo>
      </div>
      {campoLoja('Loja', 'Onde comprou')}
    </CardSecao>
  )

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Link
          href={item.estado === 'desejo' ? '/desejos' : '/colecao'}
          className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-link hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {item.estado === 'desejo' ? 'Desejos' : 'Coleção'}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Mais opções (excluir item)"
            className="flex size-11 items-center justify-center rounded-[10px] border border-border bg-card text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal className="size-5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-danger-text" onClick={() => setDeleteOpen(true)}>
              Excluir item
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:flex-wrap lg:items-start lg:gap-9">
        {/* Coluna da capa */}
        <div className="mx-auto flex w-[200px] flex-col gap-3 lg:sticky lg:top-5 lg:mx-0 lg:w-auto lg:min-w-[240px] lg:flex-[0_1_300px]">
          <div
            className={cn(
              'relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-surface-2 shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_20px_48px_rgba(0,0,0,0.55)]',
              desejo && 'border-2 border-dashed border-warning'
            )}
          >
            {capaUrl ? (
              <Image unoptimized src={capaUrl} alt={titulo} fill sizes="300px" className={cn('object-cover', desejo && 'opacity-60')} />
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">sem capa</div>
            )}
            <span
              className={cn(
                'absolute top-2 right-2 rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-primary-foreground uppercase',
                selo.className
              )}
            >
              {selo.texto}
            </span>
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11 rounded-[10px] text-[13px]"
              onClick={handleBuscarCapaAutomatica}
              disabled={buscandoCapa}
              title="A cobertura automática de edições brasileiras é irregular — enviar foto é normal."
            >
              {buscandoCapa ? 'Buscando...' : 'Buscar capa'}
            </Button>
            <Button
              variant="outline"
              className="h-11 rounded-[10px] text-[13px]"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? 'Enviando...' : 'Enviar foto'}
            </Button>
          </div>

          <dl
            className={cn(
              'mt-1 hidden flex-col gap-2.5 rounded-[14px] border bg-card p-3.5 text-sm lg:flex',
              desejo ? 'border-dashed border-warning/60' : 'border-border'
            )}
          >
            {resumo.map((r) => (
              <div key={r.rotulo} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{r.rotulo}</dt>
                <dd className={cn('m-0', r.className)}>{r.valor}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Coluna principal */}
        <div className="flex min-w-0 flex-col gap-[18px] lg:flex-[1_1_520px]">
          {candidatos && candidatos.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
              <p className="text-sm text-foreground">Encontrei {candidatos.length} candidato(s) — escolha a capa certa:</p>
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

          <div>
            <h1 className="font-heading text-[28px] leading-[1.05] font-extrabold tracking-tight lg:text-[40px]">
              {titulo || 'Sem título'}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <TipoBadge tipo={tipo} />
              {item.serie ? item.serie.nome : 'Avulso (sem série)'}
              {numeroVolume && ` · #${numeroVolume}`}
            </div>
            {/* Mobile: o resumo vira uma linha de chips sob o título. */}
            <div className="mt-3 flex flex-wrap gap-1.5 lg:hidden">
              {resumo.map((r) => (
                <span key={r.rotulo} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
                  {r.rotulo}: <span className="text-foreground">{r.valor}</span>
                </span>
              ))}
            </div>
          </div>

          <SegmentedControl<EstadoItem>
            ariaLabel="Estado"
            value={estado}
            onChange={setEstado}
            options={[
              { value: 'desejo', label: 'Desejo', activeClassName: 'bg-warning font-bold text-primary-foreground' },
              { value: 'comprado', label: 'Comprado', activeClassName: 'bg-primary font-bold text-primary-foreground' },
              { value: 'lido', label: 'Lido', activeClassName: 'bg-read font-bold text-primary-foreground' },
            ]}
            className="max-w-[460px] rounded-xl bg-card [&_button]:h-11 [&_button]:rounded-[9px]"
          />

          {/* Bloco de estado */}
          {desejo && (
            <section className="flex flex-col gap-4 rounded-2xl border border-dashed border-warning/60 bg-warning/[0.07] p-[18px]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-heading text-[19px] font-bold">Na lista de desejos</h2>
                <Button
                  className="h-11 gap-2 rounded-xl bg-success px-[18px] text-[15px] font-bold text-primary-foreground hover:bg-success/90"
                  onClick={() => setAdquirindo(true)}
                >
                  <Check className="size-[18px]" strokeWidth={2.4} aria-hidden />
                  Adquirir
                </Button>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
                <div className="flex flex-col gap-1.5">
                  <span id="prio-rotulo" className="text-[13px] text-muted-foreground">Prioridade</span>
                  <div
                    role="group"
                    aria-labelledby="prio-rotulo"
                    className="flex h-11 items-center self-start overflow-hidden rounded-[10px] border border-input bg-surface-2"
                  >
                    <button
                      type="button"
                      aria-label="Diminuir prioridade"
                      className="flex size-11 items-center justify-center hover:bg-white/5"
                      onClick={() => setPrioridade(String(Math.max(0, (Number(prioridade) || 0) - 1)))}
                    >
                      <Minus className="size-5" aria-hidden />
                    </button>
                    <span className="min-w-10 text-center font-heading text-lg font-extrabold tabular-nums">{Number(prioridade) || 0}</span>
                    <button
                      type="button"
                      aria-label="Aumentar prioridade"
                      className="flex size-11 items-center justify-center hover:bg-white/5"
                      onClick={() => setPrioridade(String((Number(prioridade) || 0) + 1))}
                    >
                      <Plus className="size-5" aria-hidden />
                    </button>
                  </div>
                  <span className="text-xs text-muted-foreground">Maior número = comprar antes.</span>
                </div>
                {campoPreco('Preço esperado')}
                {campoLoja('Onde encontrar', 'Loja ou site')}
              </div>
            </section>
          )}

          {comprado && (
            <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-[18px]">
              <div className="flex gap-0.5" aria-hidden>
                {Array.from({ length: 5 }, (_, i) => (
                  <Star key={i} className="size-[26px] text-input" strokeWidth={1.4} />
                ))}
              </div>
              <div className="min-w-0 flex-[1_1_220px]">
                <h2 className="font-heading text-[19px] font-bold">Ainda não lido</h2>
                <p className="text-sm text-muted-foreground">
                  Está na sua fila de leitura. Ao terminar, dê uma nota e escreva a crítica.
                </p>
              </div>
              <Button
                className="h-11 rounded-xl bg-success px-[18px] text-[15px] font-bold text-primary-foreground hover:bg-success/90"
                onClick={() => setAvaliando(true)}
              >
                Marcar como lido
              </Button>
            </section>
          )}

          {lido && (
            <section className="flex flex-col gap-3.5 rounded-2xl border border-border bg-card p-[18px]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-heading text-[19px] font-bold">Minha leitura</h2>
                <div className="flex items-center gap-2">
                  <Estrelas valor={nota} onChange={setNota} tamanho={30} mostrarValor={false} />
                  <span className="min-w-8 font-heading text-xl font-extrabold text-warning-text tabular-nums">
                    {nota === null ? '—' : formatarNota(nota)}
                  </span>
                </div>
              </div>
              <Campo rotulo="Crítica" id="critica">
                <Textarea
                  className="rounded-xl bg-surface-2 px-3.5 py-3 text-[15px] leading-[1.55]"
                  id="critica"
                  rows={5}
                  value={critica}
                  onChange={(e) => setCritica(e.target.value)}
                  placeholder="O que você achou da leitura?"
                />
              </Campo>
            </section>
          )}

          {/* Tags */}
          <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-[18px]">
            <h2 className="font-heading text-[19px] font-bold">Tags</h2>
            {TIPOS_TAG_DEDICADOS.map(({ tipo: tipoTag, label, multiple }) => {
              const proprias = tagsPorTipo[tipoTag]
              const herdadas = tagsHerdadas.filter((t) => t.tipo === tipoTag)
              if (proprias.length === 0 && herdadas.length === 0) return null
              return (
                <div key={tipoTag} className="flex flex-wrap items-center gap-2">
                  <span className="mr-0.5 text-xs text-muted-foreground">{label}</span>
                  {herdadas.map((t) => (
                    <span
                      key={t.id}
                      title="Herdada da série"
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-border-strong px-3 text-[13px]"
                    >
                      <Layers className="size-3" aria-hidden />
                      {t.nome}
                    </span>
                  ))}
                  {proprias.map((t) => (
                    <span key={t.id} className="inline-flex h-8 items-center gap-1 rounded-full bg-primary/20 pr-1.5 pl-3 text-[13px] font-medium">
                      {t.nome}
                      <button
                        type="button"
                        aria-label={`Remover ${t.nome}`}
                        className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                        onClick={() => setTagsPorTipo((prev) => ({ ...prev, [tipoTag]: prev[tipoTag].filter((x) => x.id !== t.id) }))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {multiple && proprias.length > 0 && (
                    <TagTypeCombobox
                      tipo={tipoTag}
                      label={label}
                      multiple
                      value={proprias}
                      onChange={(tags) => setTagsPorTipo((prev) => ({ ...prev, [tipoTag]: tags }))}
                      gatilho={<Plus className="size-4" aria-label={`Adicionar ${label}`} />}
                      gatilhoClassName="flex size-8 items-center justify-center rounded-full border border-dashed border-input text-link"
                    />
                  )}
                </div>
              )
            })}
            <div className="flex flex-wrap gap-2">
              {TIPOS_TAG_DEDICADOS.filter(
                ({ tipo: tipoTag }) => tagsPorTipo[tipoTag].length === 0 && !tagsHerdadas.some((t) => t.tipo === tipoTag)
              ).map(({ tipo: tipoTag, label, multiple }) => (
                <TagTypeCombobox
                  key={tipoTag}
                  tipo={tipoTag}
                  label={label}
                  multiple={multiple}
                  value={tagsPorTipo[tipoTag]}
                  onChange={(tags) => setTagsPorTipo((prev) => ({ ...prev, [tipoTag]: tags }))}
                  gatilho={`+ ${label}`}
                  gatilhoClassName="h-9 rounded-full border border-dashed border-input px-3 text-[13px] text-link"
                />
              ))}
            </div>
          </section>

          {/* Dados | Compra (comprado: Compra primeiro) */}
          <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
            {comprado ? (
              <>
                {cardCompra}
                {cardDados}
              </>
            ) : desejo ? (
              cardDados
            ) : (
              <>
                {cardDados}
                {cardCompra}
              </>
            )}
          </div>

          {desejo && (
            <p className="flex items-center gap-2 rounded-xl border border-dashed border-border-strong px-3.5 py-3 text-[13px] text-muted-foreground">
              <Star className="size-4 shrink-0" aria-hidden />
              Nota e crítica aparecem quando você marcar como lido.
            </p>
          )}
        </div>
      </div>

      {alterado && (
        <>
          <div className="h-20 lg:hidden" aria-hidden />
          <div className="fixed inset-x-0 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom))] z-30 border-t border-border-strong bg-card/95 px-5 py-3 backdrop-blur lg:sticky lg:bottom-0 lg:-mx-10 lg:px-10">
            <div className="mx-auto flex max-w-[1120px] items-center gap-2 lg:gap-3">
              <span className="mr-auto text-[13px] text-warning-text lg:text-sm">● <span className="lg:hidden">Não salvo</span><span className="hidden lg:inline">Alterações não salvas</span></span>
              <Button variant="outline" className="h-11 rounded-xl px-4" onClick={descartar} disabled={isPending}>
                Descartar
              </Button>
              <Button className="h-11 rounded-xl px-[22px] font-bold" onClick={handleSave} disabled={isPending}>
                {isPending ? 'Salvando...' : (<><span className="lg:hidden">Salvar</span><span className="hidden lg:inline">Salvar alterações</span></>)}
              </Button>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Excluir "${item.titulo}"?`}
        description="Essa ação não pode ser desfeita."
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        isPending={isPending}
      />
      <AdquirirDialog
        itemIds={[item.id]}
        titulo={item.titulo}
        open={adquirindo}
        onOpenChange={setAdquirindo}
        onDone={() => router.refresh()}
      />
      <MarcarLidoDialog
        itemId={item.id}
        titulo={item.titulo}
        open={avaliando}
        onOpenChange={setAvaliando}
        onDone={() => router.refresh()}
      />
    </div>
  )
}

function Campo({ rotulo, id, children }: { rotulo: string; id?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-[13px] font-normal text-muted-foreground">
        {rotulo}
      </Label>
      {children}
    </div>
  )
}

const DESKTOP = '(min-width: 1024px)'
function useDesktop() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(DESKTOP)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(DESKTOP).matches,
    () => false
  )
}

/** Card da ficha: no desktop sempre aberto; no mobile vira um bloco recolhível. */
function CardSecao({
  titulo,
  aberto,
  onAbertoChange,
  className,
  children,
}: {
  titulo: string
  aberto: boolean
  onAbertoChange: (aberto: boolean) => void
  className?: string
  children: ReactNode
}) {
  const desktop = useDesktop()
  const caixa = 'rounded-2xl border border-border bg-card'
  if (desktop) {
    return (
      <section className={cn(caixa, 'flex flex-col gap-3 p-[18px]', className)}>
        <h2 className="font-heading text-[19px] font-bold">{titulo}</h2>
        {children}
      </section>
    )
  }
  return (
    <details open={aberto} onToggle={(e) => onAbertoChange(e.currentTarget.open)} className={cn(caixa, 'group', className)}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-heading text-[17px] font-bold [&::-webkit-details-marker]:hidden">
        {titulo}
        <ChevronDown className="size-5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>
    </details>
  )
}
