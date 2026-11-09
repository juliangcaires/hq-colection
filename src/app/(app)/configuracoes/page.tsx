import { createClient } from '@/lib/supabase/server'
import { ConfiguracaoCapas } from '@/components/configuracoes/configuracao-capas'
import { ConfiguracaoLink } from '@/components/configuracoes/configuracao-link'
import { ConfiguracaoPerfil } from '@/components/configuracoes/configuracao-perfil'
import { BackButton } from '@/components/ui/back-button'
import type { SecaoCompartilhavel } from '@/lib/compartilhamento'

export const metadata = { title: 'Configurações' }

export default async function ConfiguracoesPage() {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims.sub

  const [{ data: perfil }, { data: link }] = userId
    ? await Promise.all([
        supabase.from('perfis').select('apelido, nome_exibicao, contribuir_capas').eq('user_id', userId).maybeSingle(),
        supabase.from('compartilhamentos').select('token, escopo').eq('user_id', userId).is('revogado_em', null).maybeSingle(),
      ])
    : [{ data: null }, { data: null }]

  return (
    <div className="flex flex-col gap-6">
      <BackButton />
      <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Configurações</h1>
      <ConfiguracaoPerfil apelidoInicial={perfil?.apelido ?? ''} nomeInicial={perfil?.nome_exibicao ?? ''} />
      <ConfiguracaoLink
        tokenInicial={link?.token ?? null}
        escopoInicial={(link?.escopo ?? []) as SecaoCompartilhavel[]}
      />
      <ConfiguracaoCapas contribuirInicial={perfil?.contribuir_capas === true} />
    </div>
  )
}
