import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listarRanking, type ItemDoRanking } from '@/lib/queries'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { lerLimiteRanking, RANKING_POR_PAGINA } from '@/lib/filtros-url'
import { lerFiltrosRanking, type BarraDoHistograma } from '@/lib/ranking'
import { carregarEstadoDosAmigos, carregarRankingAmigos, lerFiltrosAmigos } from '@/lib/ranking-amigos'
import { RankingAmigos } from '@/components/ranking/ranking-amigos'
import { CarregarMais } from '@/components/itens/carregar-mais'
import { Estrelas } from '@/components/ui/estrelas'
import { formatarNota } from '@/lib/nota'
import { ScrollRestore } from '@/components/ui/scroll-restore'
import { cn } from '@/lib/utils'
import { hrefDoItem } from '@/lib/navegacao-item'
import { Button } from '@/components/ui/button'
import { SeloSpoiler } from '@/components/ui/critica-spoiler'

type SearchParams = Record<string, string | undefined>

const TIPOS = [
  { valor: undefined, label: 'Todos' },
  { valor: 'hq', label: 'HQ' },
  { valor: 'manga', label: 'Mangá' },
] as const

function Capa({ item, capaUrl, className }: { item: ItemDoRanking; capaUrl: string | null; className?: string }) {
  return (
    <div className={cn('relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-2 ring-1 ring-white/10', className)}>
      {capaUrl ? (
        <Image unoptimized src={capaUrl} alt={item.titulo} fill sizes="160px" className="object-cover" />
      ) : (
        <div className="flex h-full items-end p-1.5 font-heading text-xs leading-tight font-extrabold">{item.titulo}</div>
      )}
    </div>
  )
}

function subtitulo(item: ItemDoRanking) {
  if (!item.serie) return null
  const num = item.serie.tem_numeracao && item.numero_volume !== null ? `#${item.numero_volume} ` : ''
  return `${num}${item.serie.nome}`
}

/** Link para /ranking mantendo os filtros atuais, trocando/removendo `mudar` e zerando a paginação. */
function href(params: SearchParams, mudar: Record<string, string | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...params, limite: undefined, ...mudar })) if (v) q.set(k, v)
  const t = q.toString()
  return t ? `/ranking?${t}` : '/ranking'
}

function Histograma({ barras, selecionada, params }: { barras: BarraDoHistograma[]; selecionada?: number; params: SearchParams }) {
  const max = Math.max(1, ...barras.map((b) => b.quantidade))
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-sm text-muted-foreground">Minhas notas</p>
      <ol aria-label="Distribuição das minhas notas" className="flex h-24 items-end gap-1">
        {barras.map((b) => {
          const ativa = selecionada === b.nota
          const rotulo = `${formatarNota(b.nota)} ${b.nota === 1 ? 'estrela' : 'estrelas'}: ${b.quantidade} ${b.quantidade === 1 ? 'item' : 'itens'}${ativa ? ' (filtro ativo, toque para limpar)' : ''}`
          return (
            <li key={b.nota} className="h-full min-w-0 flex-1">
              <Link
                href={href(params, { nota: ativa ? undefined : String(b.nota) })}
                aria-label={rotulo}
                aria-current={ativa ? 'true' : undefined}
                title={rotulo}
                className="flex h-full flex-col items-center justify-end gap-0.5 rounded-sm hover:bg-white/[0.05]"
              >
                <span className="text-[10px] leading-none text-muted-foreground tabular-nums">{b.quantidade || ''}</span>
                <span
                  className={cn('w-full rounded-t-sm', ativa ? 'bg-primary' : 'bg-warning/70')}
                  style={{ height: `${b.quantidade === 0 ? 2 : Math.max(6, (b.quantidade / max) * 100)}%` }}
                />
                <span className={cn('text-[10px] leading-none tabular-nums', ativa ? 'font-bold text-foreground' : 'text-muted-foreground')}>
                  {formatarNota(b.nota)}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function AbasDoRanking({ aba, tipo }: { aba: 'meu' | 'amigos'; tipo?: string }) {
  const abas = [
    { id: 'meu', label: 'Meu ranking', href: href({ tipo }, {}) },
    { id: 'amigos', label: 'Amigos', href: `/ranking?${new URLSearchParams({ aba: 'amigos', ...(tipo === 'hq' || tipo === 'manga' ? { tipo } : {}) }).toString()}` },
  ] as const
  return (
    <nav aria-label="Abas do ranking" className="flex w-full max-w-72 gap-1 rounded-xl border border-border bg-card p-1">
      {abas.map((a) => (
        <Link
          key={a.id}
          href={a.href}
          aria-current={aba === a.id ? 'page' : undefined}
          className={cn(
            'flex h-10 flex-1 items-center justify-center rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground',
            aba === a.id && 'bg-primary font-semibold text-primary-foreground hover:text-primary-foreground'
          )}
        >
          {a.label}
        </Link>
      ))}
    </nav>
  )
}

export default async function RankingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const aba = params.aba === 'amigos' ? 'amigos' : 'meu'
  const filtros = lerFiltrosRanking(params)
  const { tipo } = filtros
  const limite = lerLimiteRanking(params.limite)

  const supabase = await createClient()
  if (aba === 'amigos') {
    const filtrosAmigos = lerFiltrosAmigos(params)
    const hoje = new Date()
    const [{ linhas, total }, estado] = await Promise.all([
      carregarRankingAmigos(supabase, filtrosAmigos, limite, hoje),
      carregarEstadoDosAmigos(supabase),
    ])
    // Capa dos SEUS itens que casam com as linhas (RLS: só os seus).
    const meusIds = linhas.map((l) => l.meuItemId).filter((id): id is string => Boolean(id))
    const { data: meus } = meusIds.length > 0 ? await supabase.from('itens').select('id, capa_url').in('id', meusIds) : { data: [] }
    const capaDosMeus = new Map((meus ?? []).map((m) => [m.id as string, (m.capa_url as string | null) ?? null]))
    return (
      <div className="flex flex-col gap-6">
        <ScrollRestore />
        <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Ranking</h1>
        <AbasDoRanking aba={aba} tipo={params.tipo} />
        <RankingAmigos params={params} filtros={filtrosAmigos} linhas={linhas} total={total} limite={limite} estado={estado} capaDosMeus={capaDosMeus} hoje={hoje} />
      </div>
    )
  }

  const [{ itens, total, resumo, histograma, anos }, { data: tagsData }, { data: seriesData }] = await Promise.all([
    listarRanking(supabase, filtros, limite),
    supabase.from('tags').select('id, nome, tipo').order('nome'),
    supabase.from('series').select('id, nome').order('nome'),
  ])
  const tags = tagsData ?? []
  const series = seriesData ?? []
  const capaMap = urlsDeCapas(itens.map((i) => i.capa_url))
  const capa = (i: ItemDoRanking) => capaMap.get(i.capa_url ?? '') ?? null

  const podio = itens.slice(0, 3)
  const resto = itens.slice(3)
  const filtrando = Boolean(filtros.periodo || filtros.tagId || filtros.serieId || filtros.comCritica || filtros.nota !== undefined)
  const selectCls = 'h-10 w-full rounded-lg border border-border bg-card px-2 text-sm text-foreground'

  return (
    <div className="flex flex-col gap-6">
      <ScrollRestore />
      <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Ranking</h1>

      <AbasDoRanking aba={aba} tipo={params.tipo} />

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

      <form method="get" action="/ranking" className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-3 lg:grid-cols-6">
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        {filtros.nota !== undefined && <input type="hidden" name="nota" value={filtros.nota} />}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Ordenar por
          <select name="ordem" defaultValue={filtros.ordem} className={selectCls}>
            <option value="nota">Nota</option>
            <option value="leitura">Data de leitura</option>
            <option value="serie">Série</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Período (leitura)
          <select name="periodo" defaultValue={filtros.periodo ?? ''} className={selectCls}>
            <option value="">Sempre</option>
            <option value="este-ano">Este ano</option>
            <option value="12m">Últimos 12 meses</option>
            {anos.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
            {filtros.periodo && /^\d{4}$/.test(filtros.periodo) && !anos.includes(Number(filtros.periodo)) && (
              <option value={filtros.periodo}>{filtros.periodo}</option>
            )}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Tag ou editora
          <select name="tag" defaultValue={filtros.tagId ?? ''} className={selectCls}>
            <option value="">Todas</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.nome}{t.tipo === 'editora' ? ' (editora)' : ''}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Série
          <select name="serie" defaultValue={filtros.serieId ?? ''} className={selectCls}>
            <option value="">Todas</option>
            {series.map((x) => (
              <option key={x.id} value={x.id}>{x.nome}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-foreground">
          <input type="checkbox" name="critica" value="1" defaultChecked={filtros.comCritica} className="size-4" />
          Com crítica
        </label>
        <div className="flex items-end gap-2">
          <Button type="submit" className="h-10 flex-1">Aplicar</Button>
          {filtrando && (
            <Link href={href({ tipo: params.tipo, ordem: params.ordem }, {})} className="flex h-10 items-center text-sm text-link hover:underline">
              Limpar
            </Link>
          )}
        </div>
      </form>

      <section className="flex flex-wrap items-end gap-x-8 gap-y-4 rounded-xl border border-border bg-card p-4">
        <div>
          <p className="text-sm text-muted-foreground">Nota média</p>
          <p className="font-heading text-[32px] leading-tight font-extrabold text-warning-text">
            {resumo.media === null ? '—' : `★ ${formatarNota(Math.round(resumo.media * 100) / 100)}`}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{resumo.avaliados}</span>{' '}
          {resumo.avaliados === 1 ? 'lido avaliado' : 'lidos avaliados'}
          {resumo.semNota > 0 && (
            <>
              {' · '}
              <Link href="/colecao?estado=lido" className="text-link hover:underline">
                {resumo.semNota} sem nota
              </Link>
            </>
          )}
        </p>
        <Histograma barras={histograma} selecionada={filtros.nota} params={params} />
      </section>

      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filtrando || resumo.avaliados > 0
            ? 'Nenhum item avaliado combina com esses filtros. Tente limpar algum deles.'
            : 'Nada avaliado ainda. Marque um item como lido e dê uma nota para ele aparecer aqui.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 lg:max-w-[680px] lg:gap-5">
            {podio.map((item, i) => (
              <Link key={item.id} href={hrefDoItem(item.id, '/ranking')} className="group flex flex-col gap-2">
                <div className="relative">
                  <Capa item={item} capaUrl={capa(item)} className="group-hover:ring-primary/40" />
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
                  <span className="truncate text-[13px] font-medium text-foreground">{item.titulo}</span>
                  {subtitulo(item) && <span className="truncate text-xs text-muted-foreground">{subtitulo(item)}</span>}
                  <span className="flex items-center gap-1.5">
                    <Estrelas valor={item.nota} tamanho={14} className="max-lg:hidden" />
                    <span className="font-heading text-sm font-extrabold text-warning-text lg:hidden">★ {formatarNota(item.nota)}</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {resto.length > 0 && (
            <ol start={4} className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
              {resto.map((item, i) => (
                <li key={item.id}>
                  <Link href={hrefDoItem(item.id, '/ranking')} className="flex items-center gap-3 p-3 hover:bg-white/[0.03]">
                    <span className="w-7 shrink-0 text-center font-heading text-lg font-extrabold text-muted-foreground tabular-nums">
                      {i + 4}
                    </span>
                    <Capa item={item} capaUrl={capa(item)} className="w-[52px] shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">{item.titulo}</span>
                      {subtitulo(item) && <span className="truncate text-xs text-muted-foreground">{subtitulo(item)}</span>}
                      {item.critica && (
                        <span className="line-clamp-2 text-xs text-muted-foreground/90">
                          {item.critica_spoiler && <SeloSpoiler className="mr-1.5 align-middle" />}
                          {item.critica}
                        </span>
                      )}
                    </div>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="font-heading text-base font-extrabold text-warning-text tabular-nums">★ {formatarNota(item.nota)}</span>
                      <Estrelas valor={item.nota} tamanho={12} className="max-sm:hidden" />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}

          <CarregarMais
            params={params}
            limite={limite}
            mostrando={itens.length}
            total={total}
            passo={RANKING_POR_PAGINA}
          />
        </>
      )}
      </>
    </div>
  )
}
