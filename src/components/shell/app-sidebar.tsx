'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileUp, Heart, House, Layers, LayoutGrid, Plus, Settings, Tags, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { estaAtivo, iniciais } from '@/lib/nav'
import { useQuickAdd } from '@/components/quick-add/quick-add-provider'
import { Button } from '@/components/ui/button'

const PRINCIPAL = [
  { href: '/', label: 'Início', Icon: House },
  { href: '/colecao', label: 'Coleção', Icon: LayoutGrid },
  { href: '/series', label: 'Séries', Icon: Layers },
  { href: '/desejos', label: 'Desejos', Icon: Heart },
  { href: '/ranking', label: 'Ranking', Icon: Trophy },
]
const SECUNDARIA = [
  { href: '/tags', label: 'Tags', Icon: Tags },
  { href: '/importar', label: 'Importar CSV', Icon: FileUp },
  { href: '/configuracoes', label: 'Configurações', Icon: Settings },
]

function Item({ href, label, Icon, pathname }: (typeof PRINCIPAL)[number] & { pathname: string }) {
  const ativo = estaAtivo(href, pathname)
  return (
    <Link
      href={href}
      aria-current={ativo ? 'page' : undefined}
      className={cn(
        'flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors',
        ativo ? 'bg-primary/20 font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Icon className="size-[18px]" aria-hidden />
      {label}
    </Link>
  )
}

export function AppSidebar({ email, signOut }: { email?: string; signOut: () => Promise<void> }) {
  const pathname = usePathname()
  const { abrir } = useQuickAdd()

  return (
    <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col gap-5 border-r border-border bg-card px-4 py-6 lg:flex">
      <Link href="/" className="px-2 font-heading text-[22px] font-extrabold tracking-tight text-foreground">
        Minha Coleção
      </Link>
      <Button onClick={abrir} className="h-11 w-full gap-2">
        <Plus className="size-4" aria-hidden />
        Adicionar item
      </Button>
      <nav aria-label="Navegação principal" className="flex flex-col gap-1">
        {PRINCIPAL.map((l) => (
          <Item key={l.href} {...l} pathname={pathname} />
        ))}
      </nav>
      <div role="separator" className="h-px bg-border" />
      <nav aria-label="Mais" className="flex flex-col gap-1">
        {SECUNDARIA.map((l) => (
          <Item key={l.href} {...l} pathname={pathname} />
        ))}
      </nav>
      <div className="mt-auto flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
          {iniciais(email)}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-xs text-muted-foreground">{email}</span>
          <form action={signOut}>
            <button className="h-8 text-left text-sm text-link hover:underline">Sair</button>
          </form>
        </div>
      </div>
    </aside>
  )
}
