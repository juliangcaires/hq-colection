'use client'

import Link from 'next/link'
import { ChevronRight, FileUp, LogOut, Settings, Tags, Trophy, Users, HandHelping } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'

const LINKS = [
  { href: '/ranking', label: 'Ranking', desc: 'Os melhores avaliados', Icon: Trophy, cor: 'bg-warning/15 text-warning-text' },
  { href: '/amigos', label: 'Amigos', desc: 'Coleções dos seus amigos', Icon: Users, cor: 'bg-primary/15 text-link' },
  { href: '/emprestimos', label: 'Empréstimos', desc: 'O que está com outras pessoas', Icon: HandHelping, cor: 'bg-warning/15 text-warning-text' },
  { href: '/tags', label: 'Tags', desc: 'Editoras, personagens, autores…', Icon: Tags, cor: 'bg-chart-5/15 text-chart-5' },
  { href: '/importar', label: 'Importar CSV', desc: 'Traga sua planilha', Icon: FileUp, cor: 'bg-success/15 text-success-text' },
  { href: '/configuracoes', label: 'Configurações', desc: 'Capas compartilhadas e mais', Icon: Settings, cor: 'bg-primary/15 text-link' },
]

export type ContaDoUsuario = { email?: string; apelido: string | null; nome: string | null; avatarUrl: string | null }

export function AccountSheet({
  open,
  onOpenChange,
  conta,
  signOut,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  conta: ContaDoUsuario
  signOut: () => Promise<void>
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetTitle className="sr-only">Menu da conta</SheetTitle>
        <div className="flex items-center gap-3">
          <Avatar apelido={conta.apelido ?? conta.email} nome={conta.nome} url={conta.avatarUrl} size={56} />
          <span className="min-w-0 truncate text-sm text-foreground">{conta.email}</span>
        </div>
        <ul className="flex flex-col">
          {LINKS.map(({ href, label, desc, Icon, cor }) => (
            <li key={href}>
              <SheetClose
                render={<Link href={href} />}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl text-left"
              >
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${cor}`}>
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-foreground">{label}</span>
                  <span className="truncate text-xs text-muted-foreground">{desc}</span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </SheetClose>
            </li>
          ))}
        </ul>
        <form action={signOut}>
          <button className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-read/50 text-sm font-medium text-danger-soft-text">
            <LogOut className="size-4" aria-hidden />
            Sair da conta
          </button>
        </form>
      </SheetContent>
    </Sheet>
  )
}
