'use client'

import Link from 'next/link'
import { ChevronRight, FileUp, LogOut, Tags } from 'lucide-react'
import { iniciais } from '@/lib/nav'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'

const LINKS = [
  { href: '/tags', label: 'Tags', desc: 'Editoras, personagens, autores…', Icon: Tags, cor: 'bg-chart-5/15 text-chart-5' },
  { href: '/importar', label: 'Importar CSV', desc: 'Traga sua planilha', Icon: FileUp, cor: 'bg-success/15 text-success-text' },
]

export function AccountSheet({
  open,
  onOpenChange,
  email,
  signOut,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  email?: string
  signOut: () => Promise<void>
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetTitle className="sr-only">Menu da conta</SheetTitle>
        <div className="flex items-center gap-3">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-lg font-extrabold text-primary-foreground">
            {iniciais(email)}
          </span>
          <span className="min-w-0 truncate text-sm text-foreground">{email}</span>
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
