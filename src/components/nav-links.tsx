'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const NAV_LINKS = [
  { href: '/', label: 'Início' },
  { href: '/colecao', label: 'Coleção' },
  { href: '/desejos', label: 'Desejos' },
  { href: '/series', label: 'Séries' },
  { href: '/tags', label: 'Tags' },
  { href: '/importar', label: 'Importar' },
]

/**
 * A página de uma série não tem guia própria: a rota é `/serie/[id]`, no
 * singular, e sem esse apelido a barra apagaria inteira ao abrir uma série.
 *
 * `/item/[id]` ficou de fora de propósito — um item se abre tanto da Coleção
 * quanto dos Desejos, então acender uma das duas erraria metade das vezes.
 */
const APELIDOS: Record<string, string> = {
  '/serie': '/series',
}

function estaAtivo(href: string, pathname: string): boolean {
  const primeiroSegmento = `/${pathname.split('/')[1] ?? ''}`
  const rota = APELIDOS[primeiroSegmento] ?? pathname

  // Início casaria com tudo por prefixo; só a rota exata acende.
  if (href === '/') return rota === '/'
  return rota === href || rota.startsWith(`${href}/`)
}

export function NavLinks({ className, linkClassName }: { className?: string; linkClassName?: string }) {
  const pathname = usePathname()

  return (
    <nav className={className}>
      {NAV_LINKS.map((link) => {
        const ativo = estaAtivo(link.href, pathname)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={ativo ? 'page' : undefined}
            className={cn(
              'relative transition-colors hover:text-foreground',
              // O risco fica num pseudo-elemento para não empurrar o layout ao
              // trocar de guia — borda de verdade mudaria a altura da linha.
              ativo &&
                'font-medium text-foreground after:absolute after:inset-x-0 after:-bottom-1.5 after:h-0.5 after:rounded-full after:bg-primary',
              linkClassName
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
