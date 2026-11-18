import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { CartaoDeLista } from '@/components/listas/cartao-de-lista'
import { buttonVariants } from '@/components/ui/button'
import { carregarListas } from '@/lib/listas'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Listas' }

export default async function ListasPage() {
  const supabase = await createClient()
  const todas = await carregarListas(supabase)
  const minhas = todas.filter((l) => l.proprio)
  const dosAmigos = todas.filter((l) => !l.proprio)

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Listas</h1>
          <p className="text-sm text-muted-foreground">Ordem de leitura, melhores do ano, para emprestar… Só você e os seus amigos veem.</p>
        </div>
        <Link href="/listas/nova" className={cn(buttonVariants({ size: 'lg' }), 'shrink-0')}>
          <Plus aria-hidden /> Nova lista
        </Link>
      </header>

      <section aria-labelledby="minhas-listas" className="flex flex-col gap-3">
        <h2 id="minhas-listas" className="font-heading text-lg font-bold text-foreground">
          Minhas listas
        </h2>
        {minhas.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Você ainda não criou nenhuma lista.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {minhas.map((l) => (
              <CartaoDeLista key={l.id} lista={l} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="listas-dos-amigos" className="flex flex-col gap-3">
        <h2 id="listas-dos-amigos" className="font-heading text-lg font-bold text-foreground">
          Dos amigos
        </h2>
        {dosAmigos.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Quando um amigo aceito criar uma lista, ela aparece aqui.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {dosAmigos.map((l) => (
              <CartaoDeLista key={l.id} lista={l} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
