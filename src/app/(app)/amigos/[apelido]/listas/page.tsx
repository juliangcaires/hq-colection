import { createClient } from '@/lib/supabase/server'
import { CartaoDeLista } from '@/components/listas/cartao-de-lista'
import { carregarListas } from '@/lib/listas'

export const metadata = { title: 'Listas do amigo' }

/** Listas de um amigo. O layout já devolve 404 para quem não é amigo aceito; o banco confere de novo a cada leitura. */
export default async function ListasDoAmigoPage({ params }: { params: Promise<{ apelido: string }> }) {
  const { apelido } = await params
  const supabase = await createClient()
  const listas = (await carregarListas(supabase, apelido)).filter((l) => !l.proprio)

  if (listas.length === 0) {
    return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Este amigo ainda não criou listas.</p>
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {listas.map((l) => (
        <CartaoDeLista key={l.id} lista={l} />
      ))}
    </div>
  )
}
