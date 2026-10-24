import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { signOut } from './actions'
import { NavLinks } from '@/components/nav-links'
import { QuickAddButton } from '@/components/quick-add/quick-add-button'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  // Só para mostrar o e-mail: o proxy já exigiu sessão válida, então basta ler o JWT verificado.
  const { data } = await supabase.auth.getClaims()
  const email = typeof data?.claims.email === 'string' ? data.claims.email : undefined

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-heading text-lg font-semibold tracking-tight text-foreground">
              Minha Coleção
            </Link>
            <NavLinks className="hidden gap-5 text-sm text-muted-foreground sm:flex" />
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{email}</span>
            <form action={signOut}>
              <button className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
                Sair
              </button>
            </form>
          </div>
        </div>
        <NavLinks
          className="flex gap-4 overflow-x-auto border-t border-border px-4 py-2 text-sm text-muted-foreground sm:hidden"
          linkClassName="whitespace-nowrap"
        />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-24">{children}</main>

      <QuickAddButton />
    </div>
  )
}
