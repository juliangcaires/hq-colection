import { createClient } from '@/lib/supabase/server'
import { signOut } from './actions'

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Minha Coleção</h1>
        <form action={signOut}>
          <button className="rounded border border-neutral-700 px-3 py-1.5 text-sm">
            Sair
          </button>
        </form>
      </div>
      <p className="text-sm text-neutral-400">Logado como {user?.email}</p>
      <p className="text-sm text-neutral-500">
        Fase 0 (fundação) — CRUD de séries, itens e tags vem na Fase 1.
      </p>
    </main>
  )
}
