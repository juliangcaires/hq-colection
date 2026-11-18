import Link from 'next/link'
import { nomeDoMes } from '@/lib/diario'
import { rotuloDeVolume } from '@/lib/vitrine'
import type { ContagemNomeada } from '@/lib/estatisticas'
import { cn } from '@/lib/utils'

/** "Série #3" quando o título ainda não traz o número; senão o título. */
export function tituloDoVolume(v: { titulo: string; numeroVolume: number | null; serieNome: string | null }): string {
  const vol = rotuloDeVolume(v.numeroVolume)
  if (v.serieNome && vol && !v.titulo.includes(vol)) return `${v.serieNome} ${vol}`
  return v.titulo
}

export function plural(n: number, singular: string, pluralDe: string): string {
  return `${n} ${n === 1 ? singular : pluralDe}`
}

/** Seletor de ano: links (funciona sem JavaScript), o ano mostrado leva `aria-current`. */
export function SeletorDeAno({ anos, ano, rota }: { anos: number[]; ano: number; rota: string }) {
  if (anos.length === 0) return null
  return (
    <nav aria-label="Ano" className="flex flex-wrap gap-2">
      {anos.map((a) => (
        <Link
          key={a}
          href={`${rota}?ano=${a}`}
          aria-current={a === ano ? 'page' : undefined}
          className={cn(
            'flex h-11 items-center rounded-full border px-4 text-sm tabular-nums',
            a === ano ? 'border-primary bg-primary/20 font-semibold text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
          )}
        >
          {a}
        </Link>
      ))}
    </nav>
  )
}

/**
 * Leituras por mês: uma série só, então uma cor só e sem legenda (o título diz o que é). O número fica escrito em
 * cima de cada barra (não depende de cor ou de altura) e há uma tabela para leitor de tela.
 */
export function GraficoPorMes({ porMes, ano }: { porMes: number[]; ano: number }) {
  const max = Math.max(1, ...porMes)
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm text-muted-foreground">Leituras por mês em {ano}</figcaption>
      <ol aria-hidden className="flex h-36 items-end gap-1 sm:gap-2">
        {porMes.map((n, i) => (
          <li key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="text-xs leading-none text-foreground tabular-nums">{n}</span>
            <span className={cn('w-full max-w-9 rounded-t-sm', n === 0 ? 'bg-border' : 'bg-primary')} style={{ height: n === 0 ? '2px' : `${Math.max(6, (n / max) * 100)}%` }} />
            <span className="text-[10px] leading-none text-muted-foreground uppercase sm:text-xs">{nomeDoMes(`${ano}-${String(i + 1).padStart(2, '0')}`).slice(0, 3)}</span>
          </li>
        ))}
      </ol>
      <table className="sr-only">
        <caption>Leituras por mês em {ano}</caption>
        <thead>
          <tr>
            <th scope="col">Mês</th>
            <th scope="col">Leituras</th>
          </tr>
        </thead>
        <tbody>
          {porMes.map((n, i) => (
            <tr key={i}>
              <th scope="row">{nomeDoMes(`${ano}-${String(i + 1).padStart(2, '0')}`)}</th>
              <td>{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** Cartão de seção: título, conteúdo. */
export function Bloco({ titulo, children, className }: { titulo: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={titulo} className={cn('flex flex-col gap-3 rounded-2xl border border-border bg-card p-4', className)}>
      <h2 className="font-heading text-lg font-bold">{titulo}</h2>
      {children}
    </section>
  )
}

/** Lista de contagens (editoras, tags): número escrito ao lado do nome, com barra proporcional só de reforço. */
export function ListaDeContagem({ itens, vazio }: { itens: ContagemNomeada[]; vazio: string }) {
  if (itens.length === 0) return <p className="text-sm text-muted-foreground">{vazio}</p>
  const max = Math.max(1, ...itens.map((i) => i.leituras))
  return (
    <ul className="flex flex-col gap-2">
      {itens.map((i) => (
        <li key={i.nome} className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 break-words text-foreground">{i.nome}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{plural(i.leituras, 'leitura', 'leituras')}</span>
          </span>
          <span aria-hidden className="h-1.5 rounded-full bg-border">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${(i.leituras / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  )
}

export function Numero({ valor, rotulo, dica }: { valor: React.ReactNode; rotulo: string; dica?: string }) {
  return (
    <div className="rounded-[14px] border border-border bg-card p-3 lg:p-4">
      <p className="font-heading text-[26px] leading-none font-extrabold lg:text-[34px]">{valor}</p>
      <p className="mt-1 text-xs text-muted-foreground lg:text-[13px]">{rotulo}</p>
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  )
}
