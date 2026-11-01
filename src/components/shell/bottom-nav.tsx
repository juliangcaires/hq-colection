'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Heart, House, Layers, LayoutGrid, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { estaAtivo } from '@/lib/nav'
import { useQuickAdd } from '@/components/quick-add/quick-add-provider'

const ESQUERDA = [
  { href: '/', label: 'Início', Icon: House },
  { href: '/colecao', label: 'Coleção', Icon: LayoutGrid },
]
const DIREITA = [
  { href: '/series', label: 'Séries', Icon: Layers },
  { href: '/desejos', label: 'Desejos', Icon: Heart },
]

function Aba({ href, label, Icon, pathname }: (typeof ESQUERDA)[number] & { pathname: string }) {
  const ativo = estaAtivo(href, pathname)
  return (
    <Link
      href={href}
      aria-current={ativo ? 'page' : undefined}
      className={cn(
        'flex min-h-13 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
        ativo ? 'font-semibold text-foreground' : 'text-muted-foreground'
      )}
    >
      <span className={cn('flex px-4 py-1', ativo && 'rounded-[14px] bg-primary/20')}>
        <Icon className="size-[22px]" aria-hidden />
      </span>
      {label}
    </Link>
  )
}

export function BottomNav() {
  const pathname = usePathname()
  const { abrir } = useQuickAdd()

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 grid h-[calc(var(--nav-h)+env(safe-area-inset-bottom))] grid-cols-5 items-center border-t border-border bg-card/90 px-2 pt-1.5 pb-[calc(1.375rem+env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden"
    >
      {ESQUERDA.map((l) => (
        <Aba key={l.href} {...l} pathname={pathname} />
      ))}
      <button
        type="button"
        onClick={abrir}
        aria-label="Adicionar item"
        className="-mt-[18px] flex size-14 items-center justify-center justify-self-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/40 transition-transform active:scale-95"
      >
        <Plus className="size-[26px]" strokeWidth={2.6} aria-hidden />
      </button>
      {DIREITA.map((l) => (
        <Aba key={l.href} {...l} pathname={pathname} />
      ))}
    </nav>
  )
}
