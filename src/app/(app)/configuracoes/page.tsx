import { createClient } from '@/lib/supabase/server'
import { ConfiguracaoCapas } from '@/components/configuracoes/configuracao-capas'
import { ConfiguracaoFavoritos } from '@/components/configuracoes/configuracao-favoritos'
import { ConfiguracaoFeed } from '@/components/configuracoes/configuracao-feed'
import { ConfiguracaoNotificacoes } from '@/components/configuracoes/configuracao-notificacoes'
import { ConfiguracaoLink } from '@/components/configuracoes/configuracao-link'
import { ConfiguracaoPerfil } from '@/components/configuracoes/configuracao-perfil'
import { BackButton } from '@/components/ui/back-button'
import { urlDeAvatarValida } from '@/lib/avatar'
import type { SecaoCompartilhavel } from '@/lib/compartilhamento'
import { carregarCandidatas, carregarMeusFavoritos } from '@/lib/favoritos-series'
import { PREFERENCIAS_PADRAO, pushDisponivel, vapidDoAmbiente } from '@/lib/push'

export const metadata = { title: 'Configurações' }

export default async function ConfiguracoesPage() {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims.sub

  const [{ data: perfil }, { data: link }, favoritos, candidatas, { data: pushPrefs }] = userId
    ? await Promise.all([
        supabase.from('perfis').select('apelido, nome_exibicao, contribuir_capas, avatar_url, feed_ativo, escopo_amigos').eq('user_id', userId).maybeSingle(),
        supabase.from('compartilhamentos').select('token, escopo').eq('user_id', userId).is('revogado_em', null).maybeSingle(),
        carregarMeusFavoritos(supabase),
        carregarCandidatas(supabase),
        supabase.from('push_preferencias').select('notif_push_curtidas, notif_push_comentarios, notif_push_amizades').eq('user_id', userId).maybeSingle(),
      ])
    : [{ data: null }, { data: null }, [], [], { data: null }]
  // Só oferece o push quando o servidor tem as chaves (VAPID e de serviço); a chave pública vai para o navegador.
  const chavePush = pushDisponivel() ? (vapidDoAmbiente()?.publicKey ?? null) : null
  const prefs = { ...PREFERENCIAS_PADRAO, ...(pushPrefs ?? {}) }

  return (
    <div className="flex flex-col gap-6">
      <BackButton />
      <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Configurações</h1>
      <ConfiguracaoPerfil apelidoInicial={perfil?.apelido ?? ''} nomeInicial={perfil?.nome_exibicao ?? ''} avatarInicial={urlDeAvatarValida(perfil?.avatar_url)} />
      <ConfiguracaoFavoritos favoritosIniciais={favoritos} candidatas={candidatas} amigosVeemSeries={(perfil?.escopo_amigos ?? []).includes('series')} />
      <ConfiguracaoFeed ativoInicial={perfil?.feed_ativo === true} />
      <ConfiguracaoNotificacoes chavePublica={chavePush} preferenciasIniciais={{ curtidas: prefs.notif_push_curtidas, comentarios: prefs.notif_push_comentarios, amizades: prefs.notif_push_amizades }} />
      <ConfiguracaoLink
        tokenInicial={link?.token ?? null}
        escopoInicial={(link?.escopo ?? []) as SecaoCompartilhavel[]}
      />
      <ConfiguracaoCapas contribuirInicial={perfil?.contribuir_capas === true} />
    </div>
  )
}
