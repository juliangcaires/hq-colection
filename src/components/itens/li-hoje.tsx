'use client'

import { useId, useRef, useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BookCheck, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Estrelas } from '@/components/ui/estrelas'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { buscarVolumesParaLiHoje, registrarLeiturasEmLote } from '@/app/(app)/itens/actions'
import { FUSO_DO_APP, hojeIso } from '@/lib/datas'
import {
  avaliacaoVazia,
  ehUltimoPasso,
  indicadorDePasso,
  MAX_CRITICA,
  MAX_VOLUMES_DO_LOTE,
  mensagemDeConclusao,
  montarItensDoLote,
  motivoDeFicarDeFora,
  passoAnterior,
  podeEntrarNoLote,
  proximoPasso,
  rotuloDoVolume,
  temAvaliacaoDigitada,
  type AvaliacaoDoVolume,
  type VolumeDoLote,
} from '@/lib/leitura-lote'
import { desembrulhar } from '@/lib/resultado'
import { cn } from '@/lib/utils'

const ATRASO_BUSCA_MS = 300
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/

function Capa({ url, className }: { url: string | null; className?: string }) {
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-md bg-surface-2', className)}>
      {url && <Image unoptimized src={url} alt="" fill sizes="96px" className="object-cover" />}
    </div>
  )
}

/**
 * "Li hoje": o atalho para registrar várias leituras de uma vez, de séries e títulos diferentes. Dois passos num modal:
 * (1) escolher os volumes (com busca); (2) passo a passo com nota e crítica de cada um, uma data só para o lote.
 * Nada é gravado até "Concluir" (uma ação só, tudo ou nada); fechar antes descarta tudo.
 */
export function LiHoje({ className }: { className?: string }) {
  const router = useRouter()
  const idCritica = useId()
  const idData = useId()
  const [aberto, setAberto] = useState(false)
  const [etapa, setEtapa] = useState<'selecionar' | 'avaliar'>('selecionar')
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<VolumeDoLote[]>([])
  const [buscando, setBuscando] = useState(false)
  const [erroBusca, setErroBusca] = useState<string | null>(null)
  const [selecionados, setSelecionados] = useState<VolumeDoLote[]>([])
  const [data, setData] = useState('')
  const [hoje, setHoje] = useState('')
  const [indice, setIndice] = useState(0)
  const [avaliacoes, setAvaliacoes] = useState<Record<string, AvaliacaoDoVolume>>({})
  const [confirmandoSair, setConfirmandoSair] = useState(false)
  const [gravando, startGravacao] = useTransition()
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sequencia = useRef(0)

  const total = selecionados.length
  const atual = selecionados[indice]
  const dataOk = DATA_VALIDA.test(data) && (hoje === '' || data <= hoje)

  async function buscar(texto: string) {
    const minha = ++sequencia.current
    setBuscando(true)
    setErroBusca(null)
    try {
      const lista = desembrulhar(await buscarVolumesParaLiHoje(texto))
      if (minha === sequencia.current) setResultados(lista)
    } catch (e) {
      if (minha === sequencia.current) setErroBusca(e instanceof Error ? e.message : 'Não foi possível buscar')
    } finally {
      if (minha === sequencia.current) setBuscando(false)
    }
  }

  function abrir() {
    const agora = hojeIso(FUSO_DO_APP)
    setHoje(agora)
    setData(agora)
    setEtapa('selecionar')
    setTermo('')
    setSelecionados([])
    setAvaliacoes({})
    setIndice(0)
    setAberto(true)
    void buscar('')
  }

  function fecharTudo() {
    if (temporizador.current) clearTimeout(temporizador.current)
    sequencia.current++
    setAberto(false)
    setConfirmandoSair(false)
    setSelecionados([])
    setAvaliacoes({})
    setResultados([])
    setTermo('')
    setIndice(0)
    setEtapa('selecionar')
  }

  /** Fechar no meio descarta o lote: com nota ou crítica já digitada, pergunta antes. */
  function pedirParaFechar() {
    if (etapa === 'avaliar' && temAvaliacaoDigitada(avaliacoes, selecionados.map((v) => v.id))) {
      setConfirmandoSair(true)
      return
    }
    fecharTudo()
  }

  function aoDigitarBusca(texto: string) {
    setTermo(texto)
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => void buscar(texto), ATRASO_BUSCA_MS)
  }

  function alternar(v: VolumeDoLote) {
    if (!podeEntrarNoLote(v.estado)) return
    setSelecionados((atualLista) => {
      if (atualLista.some((x) => x.id === v.id)) return atualLista.filter((x) => x.id !== v.id)
      if (atualLista.length >= MAX_VOLUMES_DO_LOTE) {
        toast.error(`No máximo ${MAX_VOLUMES_DO_LOTE} volumes por vez`)
        return atualLista
      }
      return [...atualLista, v]
    })
  }

  function comecar() {
    if (total === 0 || !dataOk) return
    setIndice(0)
    setEtapa('avaliar')
  }

  function mudar(id: string, parte: Partial<AvaliacaoDoVolume>) {
    setAvaliacoes((prev) => ({ ...prev, [id]: { ...(prev[id] ?? avaliacaoVazia()), ...parte } }))
  }

  function concluir(avs: Record<string, AvaliacaoDoVolume>) {
    if (!dataOk) {
      toast.error('Confira a data da leitura')
      return
    }
    startGravacao(async () => {
      try {
        const r = desembrulhar(
          await registrarLeiturasEmLote({ data, itens: montarItensDoLote(selecionados.map((v) => v.id), avs) })
        )
        toast.success(mensagemDeConclusao(r.marcados))
        fecharTudo()
        router.refresh()
      } catch (e) {
        // Tudo ou nada: se falhou, nenhum volume foi marcado e o que foi digitado continua na tela.
        toast.error(e instanceof Error ? e.message : 'Não foi possível registrar as leituras')
      }
    })
  }

  function proximo() {
    if (ehUltimoPasso(indice, total)) concluir(avaliacoes)
    else setIndice((i) => proximoPasso(i, total))
  }

  function pular() {
    if (!atual) return
    const limpas = { ...avaliacoes, [atual.id]: avaliacaoVazia() }
    setAvaliacoes(limpas)
    if (ehUltimoPasso(indice, total)) concluir(limpas)
    else setIndice((i) => proximoPasso(i, total))
  }

  const marcados = new Set(selecionados.map((v) => v.id))
  const av = atual ? (avaliacoes[atual.id] ?? avaliacaoVazia()) : avaliacaoVazia()
  const ultimo = ehUltimoPasso(indice, total)

  return (
    <>
      <Button type="button" variant="outline" className={cn('h-11', className)} onClick={abrir}>
        <BookCheck aria-hidden /> Li hoje
      </Button>

      <Dialog open={aberto} onOpenChange={(v) => (v ? setAberto(true) : pedirParaFechar())}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          {confirmandoSair ? (
            <>
              <DialogHeader>
                <DialogTitle>Descartar as avaliações?</DialogTitle>
                <DialogDescription>
                  Nada foi salvo ainda. Se fechar agora, as notas e críticas que você digitou se perdem e nenhum volume é marcado como lido.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button className="h-11" onClick={() => setConfirmandoSair(false)}>
                  Continuar avaliando
                </Button>
                <Button variant="destructive" className="h-11" onClick={fecharTudo}>
                  Descartar
                </Button>
              </DialogFooter>
            </>
          ) : etapa === 'selecionar' ? (
            <>
              <DialogHeader>
                <DialogTitle>Li mais de uma coisa hoje</DialogTitle>
                <DialogDescription>
                  Marque os volumes que você leu, de qualquer série. Depois dá nota e crítica a cada um, em sequência.
                </DialogDescription>
              </DialogHeader>

              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  inputMode="search"
                  aria-label="Buscar volume ou série"
                  placeholder="Buscar volume ou série"
                  className="h-11 pl-9"
                  value={termo}
                  onChange={(e) => aoDigitarBusca(e.target.value)}
                />
              </div>

              <div className="flex max-h-[45dvh] min-h-24 flex-col gap-1 overflow-y-auto" aria-busy={buscando}>
                {erroBusca && <p className="p-2 text-sm text-destructive">{erroBusca}</p>}
                {!erroBusca && !buscando && resultados.length === 0 && (
                  <p className="p-2 text-sm text-muted-foreground">
                    {termo.trim() ? 'Nenhum volume encontrado.' : 'Você não tem volumes comprados na fila de leitura. Use a busca.'}
                  </p>
                )}
                {resultados.map((v) => {
                  const motivo = motivoDeFicarDeFora(v.estado)
                  const marcado = marcados.has(v.id)
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="checkbox"
                      aria-checked={marcado}
                      aria-disabled={motivo !== null}
                      onClick={() => alternar(v)}
                      className={cn(
                        'flex min-h-14 items-center gap-3 rounded-lg border border-transparent p-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        motivo ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-white/[0.04]',
                        marcado && 'border-primary bg-primary/10'
                      )}
                    >
                      <Checkbox checked={marcado} disabled={motivo !== null} tabIndex={-1} aria-hidden className="pointer-events-none size-5" />
                      <Capa url={v.capaUrl} className="h-[54px] w-9" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">{rotuloDoVolume(v)}</span>
                        {v.serieNome && !rotuloDoVolume(v).startsWith(v.serieNome) && (
                          <span className="truncate text-xs text-muted-foreground">{v.serieNome}</span>
                        )}
                        {motivo && <span className="text-xs text-muted-foreground">{motivo}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={idData}>Data da leitura (a mesma para todos)</Label>
                <Input id={idData} type="date" className="h-11" value={data} max={hoje || undefined} onChange={(e) => setData(e.target.value)} />
                {!dataOk && <p className="text-xs text-destructive">Escolha uma data que não seja no futuro.</p>}
              </div>

              <DialogFooter>
                <Button variant="outline" className="h-11" onClick={pedirParaFechar}>
                  Cancelar
                </Button>
                <Button className="h-11" onClick={comecar} disabled={total === 0 || !dataOk}>
                  {total === 0 ? 'Escolha ao menos um volume' : `Continuar com ${total} ${total === 1 ? 'volume' : 'volumes'}`}
                </Button>
              </DialogFooter>
            </>
          ) : (
            atual && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center justify-between gap-3 pr-8">
                    <span>Avaliar a leitura</span>
                    <span className="text-sm font-normal text-muted-foreground" aria-live="polite">
                      {indicadorDePasso(indice, total)}
                    </span>
                  </DialogTitle>
                  <DialogDescription className="sr-only">Nota e crítica são opcionais. Nada é salvo até concluir.</DialogDescription>
                </DialogHeader>

                <div className="flex gap-3">
                  <Capa url={atual.capaUrl} className="h-[108px] w-[72px]" />
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                    <p className="font-heading text-base font-bold break-words text-foreground">{rotuloDoVolume(atual)}</p>
                    {atual.serieNome && !rotuloDoVolume(atual).startsWith(atual.serieNome) && (
                      <p className="text-xs text-muted-foreground">{atual.serieNome}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Nota</Label>
                  <Estrelas valor={av.nota} onChange={(n) => mudar(atual.id, { nota: n })} tamanho={36} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={idCritica}>Crítica</Label>
                  <Textarea
                    id={idCritica}
                    rows={4}
                    maxLength={MAX_CRITICA}
                    value={av.critica}
                    onChange={(e) => mudar(atual.id, { critica: e.target.value })}
                    placeholder="O que você achou da leitura? (opcional)"
                    className="rounded-xl bg-surface-2"
                  />
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox checked={av.spoiler} onCheckedChange={(v) => mudar(atual.id, { spoiler: v === true })} />
                    Contém spoiler
                  </label>
                </div>

                {ultimo && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={idData}>Data da leitura (a mesma para os {total})</Label>
                    <Input id={idData} type="date" className="h-11" value={data} max={hoje || undefined} onChange={(e) => setData(e.target.value)} />
                    {!dataOk && <p className="text-xs text-destructive">Escolha uma data que não seja no futuro.</p>}
                  </div>
                )}

                <DialogFooter className="sm:justify-between">
                  <Button variant="ghost" className="h-11 text-link" onClick={() => setEtapa('selecionar')} disabled={gravando}>
                    Mudar seleção
                  </Button>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row">
                    <Button variant="outline" className="h-11" onClick={() => setIndice((i) => passoAnterior(i))} disabled={indice === 0 || gravando}>
                      Anterior
                    </Button>
                    <Button variant="outline" className="h-11" onClick={pular} disabled={gravando || (ultimo && !dataOk)}>
                      {ultimo ? 'Pular e concluir' : 'Pular'}
                    </Button>
                    <Button className="h-11" onClick={proximo} disabled={gravando || (ultimo && !dataOk)}>
                      {ultimo ? (gravando ? 'Salvando…' : 'Concluir') : 'Próximo'}
                    </Button>
                  </div>
                </DialogFooter>
              </>
            )
          )}
        </DialogContent>
      </Dialog>

    </>
  )
}
