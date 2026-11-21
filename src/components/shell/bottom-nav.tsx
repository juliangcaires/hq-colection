'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Heart, House, Layers, LayoutGrid, Newspaper, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { estaAtivo } from '@/lib/nav'
import { useQuickAdd } from '@/components/quick-add/quick-add-provider'

const ESQUERDA = [
  { href: '/', label: 'Início', Icon: House },
  { href: '/feed', label: 'Feed', Icon: Newspaper },
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
        'flex min-h-13 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
        ativo ? 'font-semibold text-foreground' : 'text-muted-foreground'
      )}
    >
      <span className={cn('flex px-3 py-1', ativo && 'rounded-[14px] bg-primary/20')}>
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
      className="fixed inset-x-0 bottom-0 z-40 h-[calc(var(--nav-h)+env(safe-area-inset-bottom))] border-t border-border bg-card/90 px-2 pt-1.5 pb-[calc(1.375rem+env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden"
    >
      {/*
        São 5 abas e o "+": com 3 de um lado e 2 do outro, o "+" numa grade de 6 colunas ficava à direita do centro.
        Agora o "+" é posicionado no meio da barra (left-1/2) e cada metade reparte o seu espaço, deixando uma folga
        (pr/pl) para o botão não cobrir as abas ao lado dele.
      */}
      <div className="relative flex h-full items-center">
        <div className="flex flex-1 items-center pr-9">
          {ESQUERDA.map((l) => (
            <Aba key={l.href} {...l} pathname={pathname} />
          ))}
        </div>
        <div className="flex flex-1 items-center pl-9">
          {DIREITA.map((l) => (
            <Aba key={l.href} {...l} pathname={pathname} />
          ))}
        </div>
        <button
          type="button"
          onClick={abrir}
          aria-label="Adicionar item"
          className="absolute top-[-9px] left-1/2 flex size-14 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/40 transition-transform active:scale-95"
        >
          <Plus className="size-[26px]" strokeWidth={2.6} aria-hidden />
        </button>
      </div>
    </nav>
  )
}
