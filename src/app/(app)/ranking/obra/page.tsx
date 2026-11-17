import { createClient } from '@/lib/supabase/server'
import { carregarObraAmigos } from '@/lib/notas-amigos'
import { AmigosDaObra } from '@/components/amigos/amigos-da-obra'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { origemValida, rotuloDaOrigem } from '@/lib/navegacao-item'

export const metadata = { title: 'Notas dos amigos' }

type SearchParams = Record<string, string | undefined>

/**
 * Painel das notas e críticas dos amigos para um volume que você não tem. Os dados vêm de `obra_amigos`, que decide
 * quem aparece (amizade aceita, escopo de notas) e nunca devolve crítica privada; a chave só aponta a obra.
 */
export default async function ObraDosAmigosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams
  const chave = (p.chave ?? '').slice(0, 400)
  const isbn = (p.isbn ?? '').slice(0, 20) || null
  const titulo = (p.titulo ?? '').slice(0, 200) || 'Volume'
  const origem = origemValida(p.de) ?? '/ranking?aba=amigos'

  const supabase = await createClient()
  const avaliacoes = await carregarObraAmigos(supabase, chave || null, isbn)

  return (
    <div className="flex flex-col gap-6">
      <Link href={origem} className="flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-link hover:underline">
        <ArrowLeft className="size-4" aria-hidden />
        {rotuloDaOrigem(origem)}
      </Link>
      <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">{titulo}</h1>
      {avaliacoes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum amigo com nota visível para este volume.</p>
      ) : (
        <AmigosDaObra avaliacoes={avaliacoes} rotulo="volume" />
      )}
    </div>
  )
}
