import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FormDeLista } from '@/components/listas/form-de-lista'
import { carregarLista } from '@/lib/listas'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const metadata = { title: 'Editar lista' }

export default async function EditarListaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const supabase = await createClient()
  const lista = await carregarLista(supabase, id)
  // Só o dono edita: amigo cai em 404 (o banco também recusaria a gravação).
  if (!lista || !lista.proprio) notFound()

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4">
      <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Editar lista</h1>
      <FormDeLista lista={{ id: lista.id, titulo: lista.titulo, descricao: lista.descricao, ordenada: lista.ordenada, tipo: lista.tipo }} />
    </div>
  )
}
