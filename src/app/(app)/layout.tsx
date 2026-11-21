import { createClient } from '@/lib/supabase/server'
import { signOut } from './actions'
import { AppHeader } from '@/components/shell/app-header'
import { AppSidebar } from '@/components/shell/app-sidebar'
import { BottomNav } from '@/components/shell/bottom-nav'
import { QuickAddProvider } from '@/components/quick-add/quick-add-provider'
import { NotificacoesProvider } from '@/components/shell/notificacoes-provider'
import { contarNaoLidas } from '@/lib/notificacoes'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  // Só para mostrar o e-mail: o proxy já exigiu sessão válida, então basta ler o JWT verificado.
  const { data } = await supabase.auth.getClaims()
  const email = typeof data?.claims.email === 'string' ? data.claims.email : undefined
  const userId = data?.claims.sub
  const [{ data: perfil }, naoLidas] = userId
    ? await Promise.all([supabase.from('perfis').select('apelido, nome_exibicao, avatar_url').eq('user_id', userId).maybeSingle(), contarNaoLidas(supabase)])
    : [{ data: null }, 0]
  const conta = { email, apelido: perfil?.apelido ?? null, nome: perfil?.nome_exibicao ?? null, avatarUrl: perfil?.avatar_url ?? null }

  return (
    <NotificacoesProvider inicial={naoLidas}>
      <QuickAddProvider>
        <div className="flex min-h-screen">
          <AppSidebar conta={conta} signOut={signOut} />
          <div className="flex min-w-0 flex-1 flex-col">
            <AppHeader conta={conta} signOut={signOut} />
            <main className="mx-auto w-full max-w-[1160px] flex-1 px-5 pt-3 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+16px)] lg:px-10 lg:py-7">
              {children}
            </main>
          </div>
        </div>
        <BottomNav />
      </QuickAddProvider>
    </NotificacoesProvider>
  )
}
