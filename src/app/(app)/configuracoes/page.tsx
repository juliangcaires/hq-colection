import { createClient } from '@/lib/supabase/server'
import { ConfiguracaoCapas } from '@/components/configuracoes/configuracao-capas'
import { BackButton } from '@/components/ui/back-button'

export const metadata = { title: 'Configurações' }

export default async function ConfiguracoesPage() {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims.sub
  const { data: perfil } = userId
    ? await supabase.from('perfis').select('contribuir_capas').eq('user_id', userId).maybeSingle()
    : { data: null }

  return (
    <div className="flex flex-col gap-6">
      <BackButton />
      <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Configurações</h1>
      <ConfiguracaoCapas contribuirInicial={perfil?.contribuir_capas === true} />
    </div>
  )
}
