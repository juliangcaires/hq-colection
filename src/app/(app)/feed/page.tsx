import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CardSemanal } from '@/components/feed/card-semanal'
import { ListaDoFeed } from '@/components/feed/lista-do-feed'
import { carregarFeed, carregarResumoSemanal } from '@/lib/feed'

export const metadata = { title: 'Feed' }

export default async function FeedPage() {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims.sub

  const [posts, resumo, { data: perfil }] = await Promise.all([
    carregarFeed(supabase),
    carregarResumoSemanal(supabase),
    userId ? supabase.from('perfis').select('feed_ativo').eq('user_id', userId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const ativo = perfil?.feed_ativo === true

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Feed</h1>
      {resumo && <CardSemanal resumo={resumo} />}
      {!ativo && (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Suas leituras não estão sendo compartilhadas. Para os amigos verem o que você lê, ligue o feed em{' '}
          <Link href="/configuracoes" className="font-medium text-foreground underline underline-offset-2">
            Configurações
          </Link>
          .
        </p>
      )}
      {posts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nada por aqui ainda. Quando você ou um amigo marcar uma leitura (com o feed ligado), ela aparece aqui.
        </p>
      ) : (
        <ListaDoFeed iniciais={posts} />
      )}
    </div>
  )
}
