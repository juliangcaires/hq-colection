import { createClient } from '@/lib/supabase/server'
import { PainelDeAmigos, type LinhaDeAmizade } from '@/components/amigos/painel-de-amigos'
import type { SecaoCompartilhavel } from '@/lib/compartilhamento'

export const metadata = { title: 'Amigos' }

export default async function AmigosPage() {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims.sub

  const [{ data: amizades, error }, { data: perfil }] = await Promise.all([
    supabase.rpc('amigos_listar'),
    userId ? supabase.from('perfis').select('apelido, escopo_amigos').eq('user_id', userId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  if (error) throw new Error(error.message)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Amigos</h1>
      <PainelDeAmigos
        amizades={(amizades ?? []) as LinhaDeAmizade[]}
        escopoInicial={((perfil?.escopo_amigos as SecaoCompartilhavel[] | undefined) ?? ['colecao', 'series', 'lidos'])}
        temApelido={Boolean(perfil?.apelido)}
      />
    </div>
  )
}
