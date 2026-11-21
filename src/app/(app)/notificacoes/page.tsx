import { createClient } from '@/lib/supabase/server'
import { ListaDeNotificacoes } from '@/components/notificacoes/lista-de-notificacoes'
import { carregarNotificacoes, type Notificacao } from '@/lib/notificacoes'

export const metadata = { title: 'Notificações' }

export default async function NotificacoesPage() {
  const supabase = await createClient()
  let iniciais: Notificacao[] = []
  let erro = false
  try {
    iniciais = await carregarNotificacoes(supabase)
  } catch (e) {
    console.error('[notificacoes]', e)
    erro = true
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Notificações</h1>
      <ListaDeNotificacoes iniciais={iniciais} erro={erro} />
    </div>
  )
}
