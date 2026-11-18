'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, BookMarked, FileUp, Heart, House, ListChecks, Newspaper, Layers, LayoutGrid, Plus, Settings, Tags, Trophy, Users, HandHelping } from 'lucide-react'
import { cn } from '@/lib/utils'
import { estaAtivo } from '@/lib/nav'
import { Avatar } from '@/components/ui/avatar'
import type { ContaDoUsuario } from './account-sheet'
import { useQuickAdd } from '@/components/quick-add/quick-add-provider'
import { Button } from '@/components/ui/button'

const PRINCIPAL = [
  { href: '/', label: 'Início', Icon: House },
  { href: '/feed', label: 'Feed', Icon: Newspaper },
  { href: '/colecao', label: 'Coleção', Icon: LayoutGrid },
  { href: '/series', label: 'Séries', Icon: Layers },
  { href: '/desejos', label: 'Desejos', Icon: Heart },
  { href: '/ranking', label: 'Ranking', Icon: Trophy },
  { href: '/diario', label: 'Diário', Icon: BookMarked },
  { href: '/estatisticas', label: 'Estatísticas', Icon: BarChart3 },
]
const SECUNDARIA = [
  { href: '/amigos', label: 'Amigos', Icon: Users },
  { href: '/listas', label: 'Listas', Icon: ListChecks },
  { href: '/emprestimos', label: 'Empréstimos', Icon: HandHelping },
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

export function AppSidebar({ conta, signOut }: { conta: ContaDoUsuario; signOut: () => Promise<void> }) {
  const pathname = usePathname()
  const { abrir } = useQuickAdd()

  return (
    <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-4 border-r border-border bg-card px-4 py-5 lg:flex">
      <Link href="/" className="shrink-0 px-2 font-heading text-[22px] font-extrabold tracking-tight text-foreground">
        Minha Coleção
      </Link>
      <Button onClick={abrir} className="h-11 w-full shrink-0 gap-2">
        <Plus className="size-4" aria-hidden />
        Adicionar item
      </Button>
      <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2">
        <nav aria-label="Navegação principal" className="flex flex-col gap-1">
          {PRINCIPAL.map((l) => (
            <Item key={l.href} {...l} pathname={pathname} />
          ))}
        </nav>
        <div role="separator" className="h-px shrink-0 bg-border" />
        <nav aria-label="Mais" className="flex flex-col gap-1">
          {SECUNDARIA.map((l) => (
            <Item key={l.href} {...l} pathname={pathname} />
          ))}
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-border pt-3">
        <Avatar apelido={conta.apelido ?? conta.email} nome={conta.nome} url={conta.avatarUrl} size={40} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-xs text-muted-foreground">{conta.email}</span>
          <form action={signOut}>
            <button className="h-8 text-left text-sm text-link hover:underline">Sair</button>
          </form>
        </div>
      </div>
    </aside>
  )
}
