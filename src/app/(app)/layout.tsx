import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { signOut } from './actions'
import { QuickAddButton } from '@/components/quick-add/quick-add-button'

const NAV_LINKS = [
  { href: '/', label: 'Início' },
  { href: '/colecao', label: 'Coleção' },
  { href: '/desejos', label: 'Desejos' },
  { href: '/series', label: 'Séries' },
  { href: '/tags', label: 'Tags' },
  { href: '/importar', label: 'Importar' },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-heading text-lg font-semibold tracking-tight text-foreground">
              Minha Coleção
            </Link>
            <nav className="hidden gap-5 text-sm text-muted-foreground sm:flex">
              {NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className="transition-colors hover:text-foreground">
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{user?.email}</span>
            <form action={signOut}>
              <button className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
                Sair
              </button>
            </form>
          </div>
        </div>
        <nav className="flex gap-4 overflow-x-auto border-t border-border px-4 py-2 text-sm text-muted-foreground sm:hidden">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="whitespace-nowrap transition-colors hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-24">{children}</main>

      <QuickAddButton />
    </div>
  )
}
