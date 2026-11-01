'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { iniciais } from '@/lib/nav'
import { AccountSheet } from './account-sheet'

export function AppHeader({ email, signOut }: { email?: string; signOut: () => Promise<void> }) {
  const [conta, setConta] = useState(false)

  return (
    <header className="flex items-center justify-between px-5 pt-3 lg:hidden">
      <Link href="/" className="font-heading text-[22px] font-extrabold tracking-tight text-foreground">
        Minha Coleção
      </Link>
      <div className="flex items-center gap-1">
        <Link
          href="/colecao"
          aria-label="Buscar na coleção"
          className="flex size-11 items-center justify-center rounded-full text-foreground"
        >
          <Search className="size-5" aria-hidden />
        </Link>
        <button
          type="button"
          onClick={() => setConta(true)}
          aria-label="Abrir menu da conta"
          className="flex size-11 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
        >
          {iniciais(email)}
        </button>
      </div>
      <AccountSheet open={conta} onOpenChange={setConta} email={email} signOut={signOut} />
    </header>
  )
}
