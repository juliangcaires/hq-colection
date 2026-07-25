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
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold">
              Minha Coleção
            </Link>
            <nav className="hidden gap-4 text-sm text-neutral-400 sm:flex">
              {NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className="hover:text-neutral-100">
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-neutral-500 sm:inline">{user?.email}</span>
            <form action={signOut}>
              <button className="rounded border border-neutral-700 px-3 py-1.5 text-sm">
                Sair
              </button>
            </form>
          </div>
        </div>
        <nav className="flex gap-4 overflow-x-auto border-t border-neutral-800 px-4 py-2 text-sm text-neutral-400 sm:hidden">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="whitespace-nowrap hover:text-neutral-100">
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
