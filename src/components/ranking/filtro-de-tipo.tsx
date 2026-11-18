import Link from 'next/link'
import { cn } from '@/lib/utils'

type SearchParams = Record<string, string | undefined>

const TIPOS = [
  { valor: undefined, label: 'Todos' },
  { valor: 'hq', label: 'HQ' },
  { valor: 'manga', label: 'Mangá' },
] as const

/** Link para /ranking mantendo os filtros atuais, trocando/removendo `mudar` e zerando a paginação. Na aba Amigos, mantém `aba=amigos`. */
function href(params: SearchParams, aba: 'meu' | 'amigos', mudar: Record<string, string | undefined>) {
  const q = new URLSearchParams()
  const base = aba === 'amigos' ? { ...params, aba: 'amigos' } : params
  for (const [k, v] of Object.entries({ ...base, limite: undefined, ...mudar })) if (v) q.set(k, v)
  const t = q.toString()
  return t ? `/ranking?${t}` : '/ranking'
}

/** Filtro Todos · HQ · Mangá do ranking (as duas abas). */
export function FiltroDeTipo({ aba, params, tipo }: { aba: 'meu' | 'amigos'; params: SearchParams; tipo?: string }) {
  return (
    <div role="group" aria-label="Tipo" className="flex w-full max-w-64 gap-1 rounded-xl border border-border bg-card p-1">
      {TIPOS.map((t) => {
        const ativo = tipo === t.valor
        return (
          <Link
            key={t.label}
            href={href(params, aba, { tipo: t.valor })}
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
  )
}
