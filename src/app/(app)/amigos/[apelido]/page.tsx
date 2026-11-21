import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FaixaFavoritos } from '@/components/favoritos/faixa-favoritos'
import { PaginaColecao } from '@/components/vitrine/paginas'
import { SECOES_DA_VITRINE } from '@/components/vitrine/vitrine-nav'
import { lerLimite } from '@/lib/filtros-url'
import { lerAmigo, lerFavoritosDoAmigo } from './dados'

export default async function PaginaInicialDoAmigo({ params, searchParams }: { params: Promise<{ apelido: string }>; searchParams: Promise<{ limite?: string }> }) {
  const { apelido } = await params
  const resumo = await lerAmigo(apelido)
  if (!resumo) return null

  if (!resumo.escopo.includes('colecao')) {
    const primeira = SECOES_DA_VITRINE.find((s) => resumo.escopo.includes(s.requer) && s.sufixo !== '')
    if (primeira) redirect(`/amigos/${apelido}${primeira.sufixo}`)
    return <p className="text-sm text-muted-foreground">Seu amigo ainda não liberou nenhuma seção.</p>
  }
  const favoritos = await lerFavoritosDoAmigo(apelido)
  const base = `/amigos/${resumo.apelido ?? apelido}`
  return (
    <>
      {/* Favoritos só aqui, na página principal do perfil (as subpáginas não carregam). Série abre a página da série na vitrine do amigo; volume único fica sem link (a página do item é só do dono). */}
      <FaixaFavoritos favoritos={favoritos} hrefDoFavorito={(f) => (f.origem === 'serie' ? `${base}/serie/${f.id}` : null)} />
      <PaginaColecao supabase={await createClient()} fonte={{ tipo: 'amigo', apelido }} resumo={resumo} limite={lerLimite((await searchParams).limite)} />
    </>
  )
}
