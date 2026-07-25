import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function Home() {
  const supabase = await createClient()

  const [{ count: totalDesejos }, { count: totalComprados }, { count: totalLidos }, { count: totalSeries }] =
    await Promise.all([
      supabase.from('itens').select('id', { count: 'exact', head: true }).eq('estado', 'desejo'),
      supabase.from('itens').select('id', { count: 'exact', head: true }).eq('estado', 'comprado'),
      supabase.from('itens').select('id', { count: 'exact', head: true }).eq('estado', 'lido'),
      supabase.from('series').select('id', { count: 'exact', head: true }),
    ])

  const cards = [
    { label: 'Na coleção', value: (totalComprados ?? 0) + (totalLidos ?? 0), href: '/colecao' },
    { label: 'Na lista de desejos', value: totalDesejos ?? 0, href: '/desejos' },
    { label: 'Séries cadastradas', value: totalSeries ?? 0, href: '/colecao' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Início</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 transition-colors hover:border-neutral-600"
          >
            <p className="text-3xl font-semibold">{card.value}</p>
            <p className="text-sm text-neutral-400">{card.label}</p>
          </Link>
        ))}
      </div>
      <p className="text-sm text-neutral-500">
        Use o botão + para adicionar um item, ou navegue por Coleção / Desejos / Tags.
      </p>
    </div>
  )
}
