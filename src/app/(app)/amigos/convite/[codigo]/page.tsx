import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AceitarConvite } from '@/components/amigos/aceitar-convite'

export const metadata = { title: 'Convite de amizade', robots: { index: false, follow: false } }

export default async function ConvitePage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params
  if (!/^[0-9a-f]{32,64}$/.test(codigo)) notFound()
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const [{ data: convite }, { data: perfil }] = await Promise.all([
    supabase.rpc('convite_inspecionar', { p_codigo: codigo }),
    claims?.claims.sub ? supabase.from('perfis').select('apelido').eq('user_id', claims.claims.sub).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const quem = convite as { nome: string; apelido: string } | null

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-8">
      <h1 className="font-heading text-[26px] font-extrabold tracking-tight">Convite de amizade</h1>
      {!quem ? (
        <p className="text-sm text-muted-foreground">
          Este convite não vale mais: já foi usado, expirou ou é o seu próprio. Peça um novo para a pessoa.
        </p>
      ) : !perfil?.apelido ? (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/45 bg-warning/10 p-4 text-sm text-warning-text">
          <p>
            <strong>{quem.nome}</strong> quer ser seu amigo no app. Antes de aceitar, defina o seu apelido para ele conseguir te encontrar.
          </p>
          <Link href="/configuracoes" className="font-medium underline underline-offset-2">
            Definir meu apelido
          </Link>
        </div>
      ) : (
        <AceitarConvite codigo={codigo} nome={quem.nome} />
      )}
    </div>
  )
}
