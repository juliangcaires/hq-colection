import Image from 'next/image'
import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Estrelas } from '@/components/ui/estrelas'
import { CarregarMais } from '@/components/itens/carregar-mais'
import { formatarNota } from '@/lib/nota'
import { cn } from '@/lib/utils'
import { hrefDoItem } from '@/lib/navegacao-item'
import { ProgressoDaSerieBarra } from '@/components/series/progresso-da-serie'
import type { ProgressoDaSerie } from '@/lib/progresso-serie'
import { RANKING_POR_PAGINA } from '@/lib/filtros-url'
import { urlsDeCapas } from '@/lib/supabase/capas'
import {
  anosParaPeriodo,
  avataresEmpilhados,
  ORDENS_AMIGOS,
  REGRA_DA_ORDEM,
  ROTULOS_ORDEM_AMIGOS,
  rotuloDeAmigos,
  situacaoVazia,
  type EstadoDosAmigos,
  type FiltrosAmigos,
  type LinhaDoRankingAmigos,
} from '@/lib/ranking-amigos'

type SearchParams = Record<string, string | undefined>

const TIPOS = [
  { valor: undefined, label: 'Todos' },
  { valor: 'hq', label: 'HQ' },
  { valor: 'manga', label: 'Mangá' },
] as const

/** Link para /ranking?aba=amigos mantendo os filtros, trocando/removendo `mudar` e zerando a paginação. */
function href(params: SearchParams, mudar: Record<string, string | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...params, aba: 'amigos', limite: undefined, ...mudar })) if (v) q.set(k, v)
  return `/ranking?${q.toString()}`
}

/** Para onde a linha leva: o seu item (se você tem) ou o painel com as notas e críticas dos amigos. */
function destino(l: LinhaDoRankingAmigos, voltar: string) {
  if (l.meuItemId) return hrefDoItem(l.meuItemId, voltar)
  const q = new URLSearchParams({ chave: l.obraChave, titulo: l.titulo, de: voltar })
  if (l.isbn) q.set('isbn', l.isbn)
  return `/ranking/obra?${q.toString()}`
}

function subtitulo(l: LinhaDoRankingAmigos) {
  if (!l.serieNome) return null
  const num = l.temNumeracao && l.numeroVolume !== null ? `#${l.numeroVolume} ` : ''
  return `${num}${l.serieNome}`
}

function Capa({ titulo, url, className }: { titulo: string; url: string | null; className?: string }) {
  return (
    <div className={cn('relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-2 ring-1 ring-white/10', className)}>
      {url ? (
        <Image unoptimized src={url} alt={titulo} fill sizes="160px" className="object-cover" />
      ) : (
        <div className="flex h-full items-end p-1.5 font-heading text-xs leading-tight font-extrabold">{titulo}</div>
      )}
    </div>
  )
}

/** Até 3 avatares sobrepostos e o "+N". */
function Avatares({ l }: { l: LinhaDoRankingAmigos }) {
  const { visiveis, extra } = avataresEmpilhados(l.avatares, l.n)
  return (
    <span className="flex items-center" aria-label={`Amigos que avaliaram: ${visiveis.map((a) => a.nome || a.apelido || 'alguém').join(', ')}${extra > 0 ? ` e mais ${extra}` : ''}`}>
      <span className="flex -space-x-2">
        {visiveis.map((a, i) => (
          <Avatar key={`${a.apelido}-${i}`} apelido={a.apelido} nome={a.nome} url={a.avatarUrl} size={22} className="ring-2 ring-card" />
        ))}
      </span>
      {extra > 0 && <span className="ml-1.5 text-xs text-muted-foreground">+{extra}</span>}
    </span>
  )
}

function Placar({ l }: { l: LinhaDoRankingAmigos }) {
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="font-heading text-base font-extrabold text-warning-text tabular-nums">★ {formatarNota(Math.round(l.media * 10) / 10)}</span>
      <span className="text-xs text-muted-foreground">{rotuloDeAmigos(l.n)}</span>
      {l.minhaNota !== null && (
        <span className="text-xs text-muted-foreground" title="Sua nota (fora da média dos amigos)">
          você: <span className="font-semibold text-foreground">★ {formatarNota(l.minhaNota)}</span>
        </span>
      )}
    </span>
  )
}

function EstadoVazio({ situacao }: { situacao: NonNullable<ReturnType<typeof situacaoVazia>> }) {
  const caixa = 'flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm'
  if (situacao === 'sem-amigos') {
    return (
      <div className={caixa}>
        <p className="text-muted-foreground">Você ainda não tem amigos aceitos. Adicione amigos para ver o que eles estão lendo e como avaliam.</p>
        <Button render={<Link href="/amigos" />} className="h-10">Adicionar amigos</Button>
      </div>
    )
  }
  if (situacao === 'sem-escopo') {
    return (
      <div className={caixa}>
        <p className="text-muted-foreground">
          Seus amigos ainda não compartilham as notas. Para aparecer aqui, cada um precisa ligar <span className="font-medium text-foreground">“amigos veem minhas notas”</span> em Amigos, na seção “O que meus amigos veem”.
          Quem tem conta mais antiga talvez não tenha ligado. Você também só aparece para eles se ligar o seu.
        </p>
        <Button variant="outline" render={<Link href="/amigos" />} className="h-10">Abrir Amigos</Button>
      </div>
    )
  }
  if (situacao === 'sem-resultado') {
    return <p className="text-sm text-muted-foreground">Nenhum volume combina com esses filtros. Tente limpar algum deles.</p>
  }
  return <p className="text-sm text-muted-foreground">Seus amigos ainda não avaliaram nenhum volume lido. Quando avaliarem, eles aparecem aqui.</p>
}

/** Aba "Amigos" do ranking: pódio + lista, uma linha por volume. */
export function RankingAmigos({
  params,
  filtros,
  linhas,
  total,
  limite,
  estado,
  capaDosMeus,
  progressoDosMeus,
  hoje,
}: {
  params: SearchParams
  filtros: FiltrosAmigos
  linhas: LinhaDoRankingAmigos[]
  total: number
  limite: number
  estado: EstadoDosAmigos
  /** `itens.capa_url` dos seus itens que casam com as linhas, por id do item. */
  capaDosMeus: Map<string, string | null>
  /** Progresso da SUA série, por id do seu item: só existe quando a linha é um volume que você tem e ele é de uma série. */
  progressoDosMeus: Map<string, ProgressoDaSerie>
  hoje: Date
}) {
  const { tipo } = filtros
  const filtrando = Boolean(filtros.periodo || filtros.tipo || filtros.soNaoLidos)
  const vazio = situacaoVazia(estado, linhas.length, filtrando)
  const voltar = href(params, { limite: params.limite })
  const caminhos = [
    ...linhas.map((l) => (l.meuItemId ? (capaDosMeus.get(l.meuItemId) ?? null) : null)),
    ...linhas.map((l) => l.capaPublica),
  ]
  const capaMap = urlsDeCapas(caminhos)
  const capaDe = (l: LinhaDoRankingAmigos) => {
    const minha = l.meuItemId ? capaDosMeus.get(l.meuItemId) : null
    if (minha) return capaMap.get(minha) ?? null
    if (l.capaPublica) return capaMap.get(l.capaPublica) || null
    return l.capaItemId ? `/feed/capa/${l.capaItemId}` : null
  }
  const podio = linhas.slice(0, 3)
  const resto = linhas.slice(3)
  const selectCls = 'h-10 w-full rounded-lg border border-border bg-card px-2 text-sm text-foreground'

  return (
    <>
      <div role="group" aria-label="Tipo" className="flex w-full max-w-64 gap-1 rounded-xl border border-border bg-card p-1">
        {TIPOS.map((t) => {
          const ativo = tipo === t.valor
          return (
            <Link
              key={t.label}
              href={href(params, { tipo: t.valor })}
              aria-current={ativo ? 'true' : undefined}
              className={cn(
                'flex h-10 flex-1 items-center justify-center rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground',
                ativo && 'bg-primary font-semibold text-primary-foreground hover:text-primary-foreground'
              )}
            >
              {t.label}
            </Link>
          )
        })}
      </div>

      <form method="get" action="/ranking" className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-4">
        <input type="hidden" name="aba" value="amigos" />
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Ordenar por
          <select name="ordem" defaultValue={filtros.ordem} className={selectCls}>
            {ORDENS_AMIGOS.map((o) => (
              <option key={o} value={o}>{ROTULOS_ORDEM_AMIGOS[o]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Período (leitura)
          <select name="periodo" defaultValue={filtros.periodo ?? ''} className={selectCls}>
            <option value="">Sempre</option>
            <option value="este-ano">Este ano</option>
            <option value="12m">Últimos 12 meses</option>
            {anosParaPeriodo(hoje, filtros.periodo).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-foreground">
          <input type="checkbox" name="nao_li" value="1" defaultChecked={filtros.soNaoLidos} className="size-4" />
          Só os que eu não li
        </label>
        <div className="flex items-end gap-2">
          <Button type="submit" className="h-10 flex-1">Aplicar</Button>
          {filtrando && (
            <Link href={href({}, {})} className="flex h-10 items-center text-sm text-link hover:underline">
              Limpar
            </Link>
          )}
        </div>
      </form>

      <p className="text-xs text-muted-foreground">{REGRA_DA_ORDEM}</p>

      {vazio ? (
        <EstadoVazio situacao={vazio} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 lg:max-w-[680px] lg:gap-5">
            {podio.map((l, i) => (
              <Link key={l.obraChave} href={destino(l, voltar)} className="group flex flex-col gap-2">
                <div className="relative">
                  <Capa titulo={l.titulo} url={capaDe(l)} className="group-hover:ring-primary/40" />
                  <span
                    className={cn(
                      'absolute top-1.5 left-1.5 flex size-8 items-center justify-center rounded-full font-heading text-base font-extrabold text-primary-foreground shadow-md',
                      i === 0 ? 'bg-warning' : 'bg-link'
                    )}
                    aria-label={`${i + 1}º lugar`}
                  >
                    {i + 1}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium text-foreground">{l.titulo}</span>
                  {subtitulo(l) && <span className="truncate text-xs text-muted-foreground">{subtitulo(l)}</span>}
                  <span className="flex items-center gap-1.5">
                    <Estrelas valor={Math.round(l.media * 2) / 2} tamanho={14} className="max-lg:hidden" mostrarValor={false} />
                    <span className="font-heading text-sm font-extrabold text-warning-text">★ {formatarNota(Math.round(l.media * 10) / 10)}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <Avatares l={l} />
                    <span>{rotuloDeAmigos(l.n)}</span>
                  </span>
                  {l.minhaNota !== null && <span className="text-xs text-muted-foreground">você: ★ {formatarNota(l.minhaNota)}</span>}
                </div>
              </Link>
            ))}
          </div>

          {resto.length > 0 && (
            <ol start={4} className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
              {resto.map((l, i) => (
                <li key={l.obraChave}>
                  <Link href={destino(l, voltar)} className="flex items-center gap-3 p-3 hover:bg-white/[0.03]">
                    <span className="w-7 shrink-0 text-center font-heading text-lg font-extrabold text-muted-foreground tabular-nums">{i + 4}</span>
                    <Capa titulo={l.titulo} url={capaDe(l)} className="w-[52px] shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-sm font-medium">{l.titulo}</span>
                      {subtitulo(l) && <span className="truncate text-xs text-muted-foreground">{subtitulo(l)}</span>}
                      {l.meuItemId && progressoDosMeus.get(l.meuItemId) && (
                        <ProgressoDaSerieBarra progresso={progressoDosMeus.get(l.meuItemId)!} compacto />
                      )}
                      <Avatares l={l} />
                    </div>
                    <Placar l={l} />
                  </Link>
                </li>
              ))}
            </ol>
          )}

          <CarregarMais params={{ ...params, aba: 'amigos' }} limite={limite} mostrando={linhas.length} total={total} passo={RANKING_POR_PAGINA} />
        </>
      )}
    </>
  )
}
