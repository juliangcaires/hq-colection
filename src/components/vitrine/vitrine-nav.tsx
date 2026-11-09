'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { SecaoCompartilhavel } from '@/lib/compartilhamento'

export type SecaoDeNav = { sufixo: string; rotulo: string; requer: SecaoCompartilhavel }

export const SECOES_DA_VITRINE: SecaoDeNav[] = [
  { sufixo: '', rotulo: 'Coleção', requer: 'colecao' },
  { sufixo: '/series', rotulo: 'Séries', requer: 'series' },
  { sufixo: '/lidos', rotulo: 'Lidos', requer: 'lidos' },
  { sufixo: '/ranking', rotulo: 'Ranking', requer: 'ranking' },
  { sufixo: '/desejos', rotulo: 'Desejos', requer: 'desejos' },
]

/** Abas das seções que o escopo libera; extras (ex.: "Comparar" nos amigos) entram por `extras`. */
export function VitrineNav({
  base,
  escopo,
  extras = [],
}: {
  base: string
  escopo: SecaoCompartilhavel[]
  extras?: { href: string; rotulo: string }[]
}) {
  const pathname = usePathname()
  const abas = [
    ...SECOES_DA_VITRINE.filter((s) => escopo.includes(s.requer)).map((s) => ({ href: `${base}${s.sufixo}`, rotulo: s.rotulo, exata: s.sufixo === '' })),
    ...extras.map((e) => ({ ...e, exata: false })),
  ]
  if (abas.length === 0) return null

  return (
    <nav aria-label="Seções" className="-mx-5 overflow-x-auto px-5 lg:mx-0 lg:px-0">
      <ul className="flex w-max gap-1 rounded-xl border border-border bg-card p-1">
        {abas.map((a) => {
          const ativa = a.exata ? pathname === a.href : pathname === a.href || pathname.startsWith(`${a.href}/`)
          return (
            <li key={a.href}>
              <Link
                href={a.href}
                aria-current={ativa ? 'page' : undefined}
                className={cn(
                  'flex h-10 items-center rounded-lg px-4 text-sm whitespace-nowrap transition-colors',
                  ativa ? 'bg-foreground font-semibold text-background' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {a.rotulo}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
