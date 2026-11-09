'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ScanBarcode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LeitorIsbn } from '@/components/quick-add/leitor-isbn'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cadastrarPorIsbn, consultarIsbn, type ConsultaIsbn, type SugestoesIsbn } from '@/app/(app)/itens/isbn-actions'
import type { ResultadoBuscaIsbn } from '@/lib/isbn-busca'
import { desembrulhar } from '@/lib/resultado'
import { numeroInvalido, parseNumeroPtBr } from '@/lib/numeros'
import type { EstadoItem, TipoObra } from '@/lib/types'
import type { ReferenciaDeTag } from '@/lib/schemas'

const ESTADOS = [
  { value: 'desejo', label: 'Desejo' },
  { value: 'comprado', label: 'Comprado' },
  { value: 'lido', label: 'Lido' },
]
const TIPOS: { value: TipoObra; label: string }[] = [
  { value: 'hq', label: 'HQ' },
  { value: 'manga', label: 'Mangá' },
]

/** Valor do select de série: id da existente, "nova" ou "nenhuma". */
const NOVA = '__nova__'
const NENHUMA = '__nenhuma__'

/**
 * Cadastro por ISBN: digita (ou escaneia) o código, confere a prévia e confirma.
 * Série, editora e autores chegam como SUGESTÃO — nada é criado sem a pessoa deixar marcado.
 */
export function QuickAddIsbn({
  onDone,
  onCadastroManual,
  isbnInicial = '',
}: {
  onDone: () => void
  /** ISBN não encontrado (ou serviço fora do ar): volta ao cadastro manual com o ISBN preenchido. */
  onCadastroManual: (isbn13: string) => void
  isbnInicial?: string
}) {
  const router = useRouter()
  const [entrada, setEntrada] = useState(isbnInicial)
  const [consulta, setConsulta] = useState<ConsultaIsbn | null>(null)
  const [escaneando, setEscaneando] = useState(false)
  const [consultando, startConsulta] = useTransition()
  const [salvando, startSalvar] = useTransition()

  function buscar(valor = entrada) {
    startConsulta(async () => {
      setConsulta(null)
      try {
        setConsulta(desembrulhar(await consultarIsbn(valor)))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao consultar o ISBN')
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          buscar()
        }}
      >
        <Label htmlFor="isbn-busca">ISBN</Label>
        <div className="flex gap-2">
          <Input
            id="isbn-busca"
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            placeholder="978-85-..."
            inputMode="numeric"
            autoComplete="off"
            maxLength={40}
            className="h-11"
          />
          <Button type="submit" className="h-11" disabled={consultando || !entrada.trim()}>
            {consultando ? 'Buscando...' : 'Buscar'}
          </Button>
        </div>
        <Button type="button" variant="outline" className="h-11 gap-2" onClick={() => setEscaneando((v) => !v)}>
          <ScanBarcode className="size-4" aria-hidden />
          {escaneando ? 'Fechar câmera' : 'Escanear código de barras'}
        </Button>
        <p className="text-xs text-muted-foreground">Aceita ISBN de 10 ou 13 dígitos, com ou sem hífen.</p>
      </form>

      {escaneando && (
        <LeitorIsbn
          onFechar={() => setEscaneando(false)}
          onIsbn={(isbn13) => {
            setEscaneando(false)
            setEntrada(isbn13)
            buscar(isbn13)
          }}
        />
      )}

      {consulta?.resultado.status === 'nao_encontrado' && (
        <SemResultado
          texto="Não encontrei esse ISBN nas bases consultadas. Você pode cadastrar à mão: o ISBN já fica preenchido e ajuda quem tiver o mesmo volume."
          onManual={() => onCadastroManual(consulta.isbn13)}
        />
      )}
      {consulta?.resultado.status === 'indisponivel' && (
        <SemResultado
          texto={
            consulta.resultado.motivo === 'quota'
              ? 'As bases de busca estão com a cota esgotada agora. Tente de novo mais tarde ou cadastre à mão.'
              : 'As bases de busca não responderam. Tente de novo ou cadastre à mão.'
          }
          onManual={() => onCadastroManual(consulta.isbn13)}
        />
      )}

      {consulta?.resultado.status === 'ok' && consulta.sugestoes && (
        <Previa
          // Nova consulta = nova prévia, sem herdar escolhas da anterior.
          key={consulta.isbn13}
          consulta={consulta}
          resultado={consulta.resultado}
          sug={consulta.sugestoes}
          salvando={salvando}
          onConfirmar={(dados) =>
            startSalvar(async () => {
              try {
                const r = desembrulhar(await cadastrarPorIsbn({ ...dados, isbn13: consulta.isbn13 }))
                toast.success(r.capa ? 'Adicionado — com capa' : 'Adicionado', r.capa ? undefined : { description: 'Sem capa automática: dá para escolher na tela do item.' })
                router.refresh()
                onDone()
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Erro ao adicionar')
              }
            })
          }
        />
      )}
    </div>
  )
}

function SemResultado({ texto, onManual }: { texto: string; onManual: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-3">
      <p className="text-sm text-muted-foreground">{texto}</p>
      <Button variant="outline" className="h-11" onClick={onManual}>
        Cadastrar manualmente
      </Button>
    </div>
  )
}

type DadosConfirmados = {
  edicaoId: string | null
  titulo: string
  tipo: TipoObra
  estado: EstadoItem
  numero_volume: number | null
  serie: { id: string } | { nova: string } | null
  editora: ReferenciaDeTag | null
  autores: ReferenciaDeTag[]
}

function Previa({
  consulta,
  resultado,
  sug,
  salvando,
  onConfirmar,
}: {
  consulta: ConsultaIsbn
  resultado: Extract<ResultadoBuscaIsbn, { status: 'ok' }>
  sug: SugestoesIsbn
  salvando: boolean
  onConfirmar: (dados: DadosConfirmados) => void
}) {
  const e = resultado.edicao

  const [titulo, setTitulo] = useState(e.titulo)
  const [numero, setNumero] = useState(e.numero_volume === null ? '' : String(e.numero_volume))
  const [tipo, setTipo] = useState<TipoObra>(e.tipo ?? 'hq')
  const [estado, setEstado] = useState<EstadoItem>('desejo')
  const [serie, setSerie] = useState<string>(
    sug.serieAutomatica && sug.series[0] ? sug.series[0].serie.id : sug.serieNovaNome ? NOVA : NENHUMA
  )
  const [nomeSerieNova, setNomeSerieNova] = useState(sug.serieNovaNome ?? '')
  // Tag que já existe vem marcada; tag que seria criada só entra se a pessoa marcar.
  const [usarEditora, setUsarEditora] = useState(Boolean(sug.editora.tag))
  const [autoresMarcados, setAutoresMarcados] = useState<boolean[]>(sug.autores.map((a) => Boolean(a.tag)))
  const [capaQuebrada, setCapaQuebrada] = useState(false)

  const opcoesSerie = [
    ...sug.series.map((s) => ({ value: s.serie.id, label: s.serie.nome })),
    ...(sug.serieNovaNome || nomeSerieNova ? [{ value: NOVA, label: `Criar série nova` }] : []),
    { value: NENHUMA, label: 'Sem série (avulso)' },
  ]

  function confirmar() {
    if (!titulo.trim()) return toast.error('Título obrigatório')
    if (numeroInvalido(numero)) return toast.error('Número do volume inválido')
    if (serie === NOVA && !nomeSerieNova.trim()) return toast.error('Dê um nome à série nova')
    onConfirmar({
      edicaoId: resultado.edicaoId,
      titulo: titulo.trim(),
      tipo,
      estado,
      numero_volume: parseNumeroPtBr(numero),
      serie: serie === NENHUMA ? null : serie === NOVA ? { nova: nomeSerieNova.trim() } : { id: serie },
      editora:
        usarEditora && sug.editora.tag
          ? { tagId: sug.editora.tag.id }
          : usarEditora && sug.editora.nomeParaCriar
            ? { criar: sug.editora.nomeParaCriar }
            : null,
      autores: sug.autores.flatMap((a, i) =>
        autoresMarcados[i] ? [a.tag ? { tagId: a.tag.id } : { criar: a.nome }] : []
      ),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {consulta.jaNaColecao.length > 0 && (
        <div role="alert" className="rounded-xl border border-warning/45 bg-warning/10 p-3 text-sm text-warning-text">
          <p className="font-medium">Você já tem este volume</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {consulta.jaNaColecao.map((i) => (
              <li key={i.id}>
                <Link href={`/item/${i.id}`} className="underline underline-offset-2">
                  {i.titulo}
                </Link>{' '}
                <span className="text-xs">({i.estado})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3">
        <div className="relative aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-lg bg-surface-2 ring-1 ring-white/10">
          {e.capa_url_externa && !capaQuebrada && (
            // eslint-disable-next-line @next/next/no-img-element -- capa de provedor externo (host liberado na CSP), antes de existir item
            <img src={e.capa_url_externa} alt="" className="size-full object-cover" onError={() => setCapaQuebrada(true)} />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <p className="text-xs text-muted-foreground">
            {resultado.fonte === 'catalogo' ? 'Do catálogo' : resultado.fonte === 'brasilapi' ? 'BrasilAPI' : 'Google Books'}
            {' · '}ISBN {consulta.isbn13}
          </p>
          {e.editora && <p className="text-muted-foreground">{e.editora}{e.ano ? ` · ${e.ano}` : ''}{e.paginas ? ` · ${e.paginas} págs.` : ''}</p>}
          {e.autores.length > 0 && <p className="text-muted-foreground">{e.autores.join(', ')}</p>}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="isbn-titulo">Título</Label>
        <Input id="isbn-titulo" className="h-11" value={titulo} onChange={(ev) => setTitulo(ev.target.value)} maxLength={200} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Série</Label>
        <Select items={opcoesSerie} value={serie} onValueChange={(v) => v && setSerie(v)}>
          <SelectTrigger className="h-11">
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
        {serie === NOVA && (
          <Input aria-label="Nome da série nova" className="h-11" value={nomeSerieNova} onChange={(ev) => setNomeSerieNova(ev.target.value)} maxLength={200} />
        )}
        {sug.series.length > 0 && !sug.serieAutomatica && serie !== sug.series[0].serie.id && (
          <p className="text-xs text-muted-foreground">Achei séries parecidas na sua coleção — confira a lista acima.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="isbn-numero">Número do volume</Label>
          <Input id="isbn-numero" className="h-11" inputMode="decimal" value={numero} onChange={(ev) => setNumero(ev.target.value)} placeholder="ex: 1" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Estado</Label>
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
      </div>

      <SegmentedControl ariaLabel="Tipo" value={tipo} onChange={setTipo} options={TIPOS} />

      {(sug.editora.tag || sug.editora.nomeParaCriar || sug.autores.length > 0) && (
        <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3">
          <legend className="px-1 text-xs text-muted-foreground">Tags</legend>
          {(sug.editora.tag || sug.editora.nomeParaCriar) && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={usarEditora} onCheckedChange={(v) => setUsarEditora(v === true)} />
              <span>
                Editora: <strong>{sug.editora.tag?.nome ?? sug.editora.nomeParaCriar}</strong>
                {!sug.editora.tag && <span className="text-xs text-muted-foreground"> (criar tag)</span>}
              </span>
            </label>
          )}
          {sug.autores.map((a, i) => (
            <label key={a.nome} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={autoresMarcados[i] ?? false}
                onCheckedChange={(v) => setAutoresMarcados((prev) => prev.map((m, j) => (j === i ? v === true : m)))}
              />
              <span>
                Autor: <strong>{a.tag?.nome ?? a.nome}</strong>
                {!a.tag && <span className="text-xs text-muted-foreground"> (criar tag)</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <Button className="h-12" onClick={confirmar} disabled={salvando}>
        {salvando ? 'Salvando...' : consulta.jaNaColecao.length > 0 ? 'Adicionar mesmo assim' : estado === 'desejo' ? 'Adicionar à lista de desejos' : 'Adicionar à coleção'}
      </Button>
    </div>
  )
}
