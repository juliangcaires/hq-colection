'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ScanBarcode, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LeitorIsbn } from '@/components/quick-add/leitor-isbn'
import { cadastrarLoteDeIsbn, consultarIsbn, type ConsultaIsbn } from '@/app/(app)/itens/isbn-actions'
import { desembrulhar } from '@/lib/resultado'
import { normalizarIsbn } from '@/lib/isbn'
import { normalizarTexto } from '@/lib/texto'
import {
  emLotes,
  linhaSalvavel,
  marcarDuplicatas,
  montarCadastro,
  NOVA_SERIE,
  SEM_SERIE,
  type LinhaPrateleira,
} from '@/lib/prateleira'
import type { EstadoItem } from '@/lib/types'

const ESTADOS = [
  { value: 'desejo', label: 'Desejo' },
  { value: 'comprado', label: 'Comprado' },
  { value: 'lido', label: 'Lido' },
]
const ITENS_POR_REQUISICAO = 8
const MAX_LINHAS = 50

let contador = 0
const novaChave = () => `l${++contador}`

function linhaDaConsulta(l: LinhaPrateleira, c: ConsultaIsbn): LinhaPrateleira {
  const r = c.resultado
  if (r.status === 'ok' && c.sugestoes) {
    const s = c.sugestoes
    return {
      ...l,
      status: 'ok',
      consulta: c,
      titulo: r.edicao.titulo,
      serie: s.serieAutomatica && s.series[0] ? s.series[0].serie.id : s.serieNovaNome ? NOVA_SERIE : SEM_SERIE,
    }
  }
  return { ...l, status: r.status === 'nao_encontrado' ? 'nao_encontrado' : 'indisponivel', consulta: c, serie: SEM_SERIE }
}

/**
 * Modo prateleira: escaneia (ou digita) vários ISBNs, revisa a lista e salva tudo de uma vez.
 * Cada item é salvo de forma independente — o que falhar fica na lista com o erro, o resto entra.
 */
export function PrateleiraIsbn({ onDone }: { onDone: () => void }) {
  const router = useRouter()
  const [linhas, setLinhas] = useState<LinhaPrateleira[]>([])
  const [entrada, setEntrada] = useState('')
  const [escaneando, setEscaneando] = useState(false)
  const [estado, setEstado] = useState<EstadoItem>('comprado')
  const [criarTags, setCriarTags] = useState(false)
  const [salvando, startSalvar] = useTransition()
  const [progresso, setProgresso] = useState<string | null>(null)
  const seriesCriadas = useRef(new Map<string, string>())
  const emConsulta = useRef(new Set<string>())
  const linhasRef = useRef(linhas)
  useEffect(() => {
    linhasRef.current = linhas
  })

  // Fila: uma consulta por vez, na ordem em que os livros foram lidos (respeita o limite de chamadas).
  useEffect(() => {
    if (emConsulta.current.size > 0) return
    const proxima = linhas.find((l) => l.status === 'consultando')
    if (!proxima) return
    emConsulta.current.add(proxima.chave)
    consultarIsbn(proxima.isbn13)
      .then((res) => {
        const c = desembrulhar(res)
        setLinhas((atual) => atual.map((l) => (l.chave === proxima.chave ? linhaDaConsulta(l, c) : l)))
      })
      .catch((e: unknown) => {
        const erro = e instanceof Error ? e.message : 'Falha na consulta'
        setLinhas((atual) => atual.map((l) => (l.chave === proxima.chave ? { ...l, status: 'erro', erro, incluir: false } : l)))
      })
      .finally(() => {
        emConsulta.current.delete(proxima.chave)
        // Dispara o efeito de novo para consultar a próxima da fila.
        setLinhas((atual) => [...atual])
      })
  }, [linhas])

  const duplicatas = useMemo(() => marcarDuplicatas(linhas), [linhas])

  function adicionar(isbn13: string) {
    if (linhasRef.current.length >= MAX_LINHAS) {
      toast.error(`No máximo ${MAX_LINHAS} livros por vez. Salve estes primeiro.`)
      return
    }
    setLinhas((atual) => {
      const repetido = atual.some((l) => l.isbn13 === isbn13 && l.status !== 'falhou')
      return [
        ...atual,
        // Repetido entra na lista (marcado como duplicata) mas desmarcado; o usuário vê e decide.
        { chave: novaChave(), isbn13, status: 'consultando', consulta: null, titulo: '', serie: SEM_SERIE, incluir: !repetido },
      ]
    })
  }

  function adicionarDigitado() {
    const isbn13 = normalizarIsbn(entrada)
    if (!isbn13) return toast.error('ISBN inválido. Confira os dígitos (10 ou 13).')
    adicionar(isbn13)
    setEntrada('')
  }

  const atualizar = (chave: string, mudanca: Partial<LinhaPrateleira>) =>
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, ...mudanca } : l)))

  const salvaveis = linhas.filter(linhaSalvavel)
  const seriesNovasPrevistas = Array.from(
    new Set(
      salvaveis
        .filter((l) => l.serie === NOVA_SERIE && l.consulta?.sugestoes?.serieNovaNome)
        .map((l) => l.consulta!.sugestoes!.serieNovaNome!)
    )
  )

  function salvarTudo() {
    const alvo = salvaveis
    if (alvo.length === 0) return
    startSalvar(async () => {
      let salvos = 0
      let falhas = 0
      const lotes = emLotes(alvo, ITENS_POR_REQUISICAO)
      for (const [n, lote] of lotes.entries()) {
        setProgresso(`Salvando ${n * ITENS_POR_REQUISICAO + 1}–${n * ITENS_POR_REQUISICAO + lote.length} de ${alvo.length}...`)
        const cadastros = lote.map((l) => montarCadastro(l, { estado, criarTags, seriesCriadas: seriesCriadas.current }))
        try {
          const resultados = desembrulhar(await cadastrarLoteDeIsbn(cadastros))
          resultados.forEach((r, i) => {
            const linha = lote[i]
            if (r.ok) {
              salvos++
              if (r.serieId && linha.serie === NOVA_SERIE && linha.consulta?.sugestoes?.serieNovaNome) {
                seriesCriadas.current.set(normalizarTexto(linha.consulta.sugestoes.serieNovaNome), r.serieId)
              }
              atualizar(linha.chave, { status: 'salvo', incluir: false, erro: undefined })
            } else {
              falhas++
              atualizar(linha.chave, { status: 'falhou', erro: r.erro })
            }
          })
        } catch (e) {
          // A requisição inteira caiu (rede, sessão): marca o lote como falho e segue para os próximos.
          falhas += lote.length
          const erro = e instanceof Error ? e.message : 'Falha ao salvar'
          for (const l of lote) atualizar(l.chave, { status: 'falhou', erro })
        }
      }
      setProgresso(null)
      if (salvos > 0) router.refresh()
      if (falhas === 0) {
        toast.success(`${salvos} ${salvos === 1 ? 'livro adicionado' : 'livros adicionados'}`)
        onDone()
      } else {
        toast.warning(`${salvos} salvos, ${falhas} com erro`, { description: 'Os que falharam continuam na lista com o motivo.' })
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Escaneie vários livros em sequência, revise a lista e salve tudo de uma vez.
      </p>

      <Button type="button" className="h-12 gap-2" onClick={() => setEscaneando((v) => !v)}>
        <ScanBarcode className="size-4" aria-hidden />
        {escaneando ? 'Parar de escanear' : 'Escanear livros'}
      </Button>
      {escaneando && <LeitorIsbn continuo onFechar={() => setEscaneando(false)} onIsbn={adicionar} />}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          adicionarDigitado()
        }}
      >
        <Input
          aria-label="Digitar ISBN"
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          placeholder="ou digite um ISBN"
          inputMode="numeric"
          autoComplete="off"
          maxLength={40}
          className="h-11"
        />
        <Button type="submit" variant="outline" className="h-11" disabled={!entrada.trim()}>
          Adicionar
        </Button>
      </form>

      {linhas.length > 0 && (
        <>
          <div className="grid grid-cols-2 items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Estado de todos</Label>
              <Select items={ESTADOS} value={estado} onValueChange={(v) => setEstado(v as EstadoItem)}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESTADOS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 pb-3 text-xs text-muted-foreground">
              <Checkbox checked={criarTags} onCheckedChange={(v) => setCriarTags(v === true)} />
              Criar tags de editora e autor novas
            </label>
          </div>

          <ul className="flex flex-col gap-2" aria-label="Livros escaneados">
            {linhas.map((l, i) => (
              <LinhaDaLista
                key={l.chave}
                linha={l}
                duplicata={duplicatas[i]}
                onMudar={(m) => atualizar(l.chave, m)}
                onRemover={() => setLinhas((atual) => atual.filter((x) => x.chave !== l.chave))}
              />
            ))}
          </ul>

          {seriesNovasPrevistas.length > 0 && (
            <p className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
              Séries novas que serão criadas: <strong className="text-foreground">{seriesNovasPrevistas.join(', ')}</strong>. Para não criar, troque a série do livro na lista.
            </p>
          )}

          <Button className="h-12" onClick={salvarTudo} disabled={salvando || salvaveis.length === 0}>
            {salvando ? (progresso ?? 'Salvando...') : `Salvar ${salvaveis.length} ${salvaveis.length === 1 ? 'livro' : 'livros'}`}
          </Button>
        </>
      )}
    </div>
  )
}

function LinhaDaLista({
  linha: l,
  duplicata,
  onMudar,
  onRemover,
}: {
  linha: LinhaPrateleira
  duplicata: 'colecao' | 'repetido' | null
  onMudar: (m: Partial<LinhaPrateleira>) => void
  onRemover: () => void
}) {
  const edicao = l.consulta?.resultado.status === 'ok' ? l.consulta.resultado.edicao : null
  const sug = l.consulta?.sugestoes ?? null
  const opcoesSerie = sug
    ? [
        ...sug.series.map((s) => ({ value: s.serie.id, label: s.serie.nome })),
        ...(sug.serieNovaNome ? [{ value: NOVA_SERIE, label: `Nova série: ${sug.serieNovaNome}` }] : []),
        { value: SEM_SERIE, label: 'Sem série' },
      ]
    : []
  const pendente = l.status === 'consultando'
  const semDados = l.status === 'nao_encontrado' || l.status === 'indisponivel' || l.status === 'erro'

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <Checkbox
          className="mt-1"
          aria-label={`Incluir ${l.titulo || l.isbn13}`}
          checked={l.incluir && l.status !== 'salvo'}
          disabled={l.status === 'salvo' || pendente}
          onCheckedChange={(v) => onMudar({ incluir: v === true })}
        />
        <div className="relative aspect-[2/3] w-10 shrink-0 overflow-hidden rounded bg-surface-2 ring-1 ring-white/10">
          {edicao?.capa_url_externa && (
            // eslint-disable-next-line @next/next/no-img-element -- miniatura de capa externa (host liberado na CSP)
            <img src={edicao.capa_url_externa} alt="" className="size-full object-cover" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {semDados && l.status !== 'salvo' ? (
            <Input
              aria-label={`Título do livro ${l.isbn13}`}
              className="h-9"
              value={l.titulo}
              placeholder="Sem dados — digite o título"
              maxLength={200}
              onChange={(e) => onMudar({ titulo: e.target.value, incluir: e.target.value.trim().length > 0 })}
            />
          ) : (
            <p className="truncate text-sm font-medium text-foreground">{pendente ? 'Buscando...' : l.titulo}</p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="tabular-nums">{l.isbn13}</span>
            {l.status === 'salvo' && <Badge variant="sucesso">salvo</Badge>}
            {duplicata === 'colecao' && <Badge variant="outline">já na coleção</Badge>}
            {duplicata === 'repetido' && <Badge variant="outline">repetido na lista</Badge>}
            {l.status === 'nao_encontrado' && <Badge variant="secondary">não encontrado</Badge>}
            {l.status === 'indisponivel' && <Badge variant="secondary">bases indisponíveis</Badge>}
          </div>
          {l.erro && (
            <p role="alert" className="text-xs text-danger-text">
              {l.erro}
            </p>
          )}
        </div>
        <Button variant="ghost" className="size-10 shrink-0 p-0 text-muted-foreground" aria-label={`Remover ${l.titulo || l.isbn13}`} onClick={onRemover}>
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>

      {l.status !== 'salvo' && opcoesSerie.length > 1 && (
        <Select items={opcoesSerie} value={l.serie} onValueChange={(v) => v && onMudar({ serie: v })}>
          <SelectTrigger className="h-10" aria-label="Série">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opcoesSerie.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </li>
  )
}
