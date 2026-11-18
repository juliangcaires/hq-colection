import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { carregarEstatisticasDaPagina } from '@/lib/estatisticas-pagina'
import { dataBr, nomeDoMes } from '@/lib/diario'
import { formatarNota } from '@/lib/nota'
import { hrefDoItem } from '@/lib/navegacao-item'
import { Estrelas } from '@/components/ui/estrelas'
import { plural, SeletorDeAno, tituloDoVolume } from '@/components/estatisticas/blocos'
import type { LeituraDoAno } from '@/lib/estatisticas'

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5 sm:p-6">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{titulo}</h2>
      {children}
    </section>
  )
}

function Grande({ children }: { children: React.ReactNode }) {
  return <p className="font-heading text-5xl leading-none font-extrabold sm:text-6xl">{children}</p>
}

function Leitura({ rotulo, leitura, de }: { rotulo: string; leitura: LeituraDoAno; de: string }) {
  return (
    <Link href={hrefDoItem(leitura.itemId, de)} className="flex flex-col gap-0.5 rounded-xl hover:bg-surface-2/60">
      <span className="text-sm text-muted-foreground">{rotulo}</span>
      <span className="font-medium break-words text-foreground">{tituloDoVolume(leitura)}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{dataBr(leitura.lidoEm)}</span>
    </Link>
  )
}

export default async function SeuAnoEmHqPage({ searchParams }: { searchParams: Promise<{ ano?: string | string[] }> }) {
  const supabase = await createClient()
  const { ano, anos, semNenhumaLeitura, estatisticas: e } = await carregarEstatisticasDaPagina(supabase, (await searchParams).ano)
  const capas = urlsDeCapas(e.top5.map((v) => v.capaUrl))
  const de = `/estatisticas/ano?ano=${ano}`
  const mes = e.mesMaisAtivo ? nomeDoMes(`${ano}-${String(e.mesMaisAtivo.mes).padStart(2, '0')}`) : null

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-[28px] font-extrabold tracking-tight">Seu {ano} em HQ</h1>
        <p className="text-sm text-muted-foreground">
          Só você vê isto. <Link href={`/estatisticas?ano=${ano}`} className="text-link hover:underline">Ver as estatísticas completas</Link>
        </p>
      </header>

      <SeletorDeAno anos={anos} ano={ano} rota="/estatisticas/ano" />

      {e.vazio ? (
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          {semNenhumaLeitura
            ? 'Ainda não há leituras com data. Marque um volume como lido e o seu ano em HQ nasce aqui.'
            : `Nenhuma leitura em ${ano}. Escolha outro ano acima.`}
        </p>
      ) : (
        <>
          <Secao titulo="O ano em números">
            <Grande>{e.leituras}</Grande>
            <p className="text-lg">
              {e.leituras === 1 ? 'leitura' : 'leituras'} em {ano}
              {e.releituras > 0 && <span className="text-muted-foreground">, {plural(e.releituras, 'releitura', 'releituras')}</span>}.
            </p>
            <p className="text-sm text-muted-foreground">
              {plural(e.volumesDistintos, 'volume diferente', 'volumes diferentes')} · {e.porTipo.hq} de HQ · {e.porTipo.manga} de mangá
            </p>
            {e.mediaDasNotas && (
              <p className="text-sm text-muted-foreground">
                Nota média: <span className="text-foreground">{formatarNota(e.mediaDasNotas.media)}</span> ({plural(e.mediaDasNotas.avaliados, 'volume avaliado', 'volumes avaliados')})
              </p>
            )}
          </Secao>

          {e.top5.length > 0 && (
            <Secao titulo="Seus 5 melhores">
              <ol className="flex flex-col gap-3">
                {e.top5.map((v, i) => {
                  const capa = v.capaUrl ? (capas.get(v.capaUrl) ?? null) : null
                  return (
                    <li key={v.itemId}>
                      <Link href={hrefDoItem(v.itemId, de)} className="flex items-center gap-3 rounded-xl hover:bg-surface-2/60">
                        <span className="w-6 shrink-0 text-center font-heading text-xl font-extrabold tabular-nums">{i + 1}</span>
                        <div className="relative h-[72px] w-12 shrink-0 overflow-hidden rounded-md bg-surface-2">
                          {capa && <Image unoptimized src={capa} alt="" fill sizes="48px" className="object-cover" />}
                        </div>
                        <span className="min-w-0 flex-1 font-medium break-words text-foreground">{tituloDoVolume(v)}</span>
                        {v.nota !== null && (
                          <span className="flex shrink-0 flex-col items-end gap-0.5">
                            <Estrelas valor={v.nota} tamanho={14} mostrarValor={false} />
                            <span className="text-xs font-medium tabular-nums">{formatarNota(v.nota)}</span>
                          </span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ol>
            </Secao>
          )}

          {e.serieMaisLida && (
            <Secao titulo="Série mais lida">
              <Link href={`/serie/${e.serieMaisLida.id}`} className="font-heading text-2xl font-extrabold break-words hover:underline">
                {e.serieMaisLida.nome}
              </Link>
              <p className="text-sm text-muted-foreground">
                {plural(e.serieMaisLida.leituras, 'leitura', 'leituras')} em {plural(e.serieMaisLida.volumes, 'volume', 'volumes')}
              </p>
            </Secao>
          )}

          {mes && e.mesMaisAtivo && (
            <Secao titulo="Mês mais ativo">
              <p className="font-heading text-4xl leading-none font-extrabold capitalize sm:text-5xl">{mes}</p>
              <p className="text-sm text-muted-foreground">{plural(e.mesMaisAtivo.leituras, 'leitura', 'leituras')}</p>
              {e.maiorSequencia && e.maiorSequencia.meses > 1 && (
                <p className="text-sm text-muted-foreground">
                  Maior sequência: {e.maiorSequencia.meses} meses seguidos lendo, de {nomeDoMes(`${ano}-${String(e.maiorSequencia.deMes).padStart(2, '0')}`)} a{' '}
                  {nomeDoMes(`${ano}-${String(e.maiorSequencia.ateMes).padStart(2, '0')}`)}.
                </p>
              )}
            </Secao>
          )}

          {(e.seriesIniciadas.length > 0 || e.seriesConcluidas.length > 0) && (
            <Secao titulo="Séries">
              <p className="text-sm">
                <span className="font-heading text-2xl font-extrabold">{e.seriesIniciadas.length}</span> {e.seriesIniciadas.length === 1 ? 'iniciada' : 'iniciadas'} ·{' '}
                <span className="font-heading text-2xl font-extrabold">{e.seriesConcluidas.length}</span> {e.seriesConcluidas.length === 1 ? 'concluída' : 'concluídas'}
              </p>
              {e.seriesConcluidas.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm">
                  {e.seriesConcluidas.map((s) => (
                    <li key={s.id}>
                      <Link href={`/serie/${s.id}`} className="text-link hover:underline">
                        {s.nome}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          )}

          {e.primeiraLeitura && e.ultimaLeitura && (
            <Secao titulo="Do começo ao fim">
              <Leitura rotulo="Primeira leitura do ano" leitura={e.primeiraLeitura} de={de} />
              {e.ultimaLeitura.leituraId !== e.primeiraLeitura.leituraId && <Leitura rotulo="Última leitura do ano" leitura={e.ultimaLeitura} de={de} />}
            </Secao>
          )}
        </>
      )}
    </div>
  )
}
