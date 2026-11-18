import Image from 'next/image'
import Link from 'next/link'
import { RotateCcw } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { agruparPorMes, anosDoDiario, carregarDiario, dataBr, escolherAno, nomeDoMes, type EntradaDoDiario } from '@/lib/diario'
import { FUSO_DO_APP, hojeIso } from '@/lib/datas'
import { rotuloDeVolume } from '@/lib/vitrine'
import { formatarNota } from '@/lib/nota'
import { hrefDoItem } from '@/lib/navegacao-item'
import { Estrelas } from '@/components/ui/estrelas'
import { cn } from '@/lib/utils'

function tituloDaEntrada(e: EntradaDoDiario): string {
  const vol = rotuloDeVolume(e.numeroVolume)
  if (e.serieNome && vol && !e.titulo.includes(vol)) return `${e.serieNome} ${vol}`
  return e.titulo
}

export default async function DiarioPage({ searchParams }: { searchParams: Promise<{ ano?: string | string[] }> }) {
  const supabase = await createClient()
  const bruto = (await searchParams).ano
  const pedido = Array.isArray(bruto) ? bruto[0] : bruto

  const entradas = await carregarDiario(supabase)
  const anos = anosDoDiario(entradas)
  const anoAtual = Number(hojeIso(FUSO_DO_APP).slice(0, 4))
  const ano = escolherAno(pedido, anos, anoAtual)
  const meses = agruparPorMes(entradas, ano)
  const totalDoAno = meses.reduce((n, m) => n + m.entradas.length, 0)
  const releiturasDoAno = meses.reduce((n, m) => n + m.entradas.filter((e) => e.releitura).length, 0)
  const capas = urlsDeCapas(meses.flatMap((m) => m.entradas.map((e) => e.capaUrl)))

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-[28px] font-extrabold tracking-tight">Diário</h1>
        <p className="text-sm text-muted-foreground">
          {totalDoAno === 0
            ? 'Cada leitura que você registra aparece aqui, mês a mês.'
            : `${totalDoAno} ${totalDoAno === 1 ? 'leitura' : 'leituras'} em ${ano}${releiturasDoAno > 0 ? `, ${releiturasDoAno} ${releiturasDoAno === 1 ? 'releitura' : 'releituras'}` : ''}.`}
        </p>
      </header>

      {anos.length > 1 && (
        <nav aria-label="Ano" className="flex flex-wrap gap-2">
          {anos.map((a) => (
            <Link
              key={a}
              href={`/diario?ano=${a}`}
              aria-current={a === ano ? 'page' : undefined}
              className={cn(
                'flex h-9 items-center rounded-full border px-4 text-sm tabular-nums',
                a === ano ? 'border-primary bg-primary/20 font-semibold text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {a}
            </Link>
          ))}
        </nav>
      )}

      {entradas.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Ainda não há leituras com data. Marque um volume como lido e ele entra aqui.
        </p>
      ) : totalDoAno === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Nenhuma leitura em {ano}.</p>
      ) : (
        meses.map((m) => (
          <section key={m.mes} aria-labelledby={`mes-${m.mes}`} className="flex flex-col gap-2">
            <h2 id={`mes-${m.mes}`} className="flex items-baseline gap-2 font-heading text-lg font-bold capitalize">
              {nomeDoMes(m.mes)}
              <span className="text-sm font-normal text-muted-foreground normal-case">{m.entradas.length}</span>
            </h2>
            <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
              {m.entradas.map((e) => {
                const capa = e.capaUrl ? (capas.get(e.capaUrl) ?? null) : null
                const titulo = tituloDaEntrada(e)
                return (
                  <li key={e.leituraId}>
                    <Link href={hrefDoItem(e.itemId, `/diario?ano=${ano}`)} className="flex items-center gap-3 p-3 hover:bg-surface-2/60">
                      <div className="relative h-[72px] w-12 shrink-0 overflow-hidden rounded-md bg-surface-2">
                        {capa && <Image unoptimized src={capa} alt="" fill sizes="48px" className="object-cover" />}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="font-medium break-words text-foreground">{titulo}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{dataBr(e.lidoEm)}</span>
                        {e.releitura && (
                          <span className="flex w-fit items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-link">
                            <RotateCcw className="size-3" aria-hidden /> releitura
                          </span>
                        )}
                      </div>
                      {e.nota !== null && (
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <Estrelas valor={e.nota} tamanho={14} mostrarValor={false} />
                          <span className="text-xs font-medium text-foreground tabular-nums">{formatarNota(e.nota)}</span>
                        </div>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
