import Link from 'next/link'
import { ListChecks } from 'lucide-react'
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
      <Link
        href="/listas"
        className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-card p-3 hover:bg-white/[0.03] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-chart-5/15 text-chart-5">
          <ListChecks className="size-[18px]" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">Listas</span>
          <span className="text-xs text-muted-foreground">Ordem de leitura, melhores do ano… as suas e as dos amigos</span>
        </span>
      </Link>
      <PainelDeAmigos
        amizades={(amizades ?? []) as LinhaDeAmizade[]}
        escopoInicial={((perfil?.escopo_amigos as SecaoCompartilhavel[] | undefined) ?? ['colecao', 'series', 'lidos', 'notas_criticas'])}
        temApelido={Boolean(perfil?.apelido)}
      />
    </div>
  )
}
