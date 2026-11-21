import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { lerFavoritosDoLink, lerLink } from './dados'
import { FaixaFavoritos } from '@/components/favoritos/faixa-favoritos'
import { Avatar } from '@/components/ui/avatar'
import { VitrineNav } from '@/components/vitrine/vitrine-nav'

// Coleção compartilhada: fora dos buscadores e sem cópia em cache (o link pode ser revogado a qualquer momento).
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const link = await lerLink(token)
  return {
    title: link.estado === 'ok' ? `Coleção de ${link.resumo.nome}` : 'Coleção compartilhada',
    robots: { index: false, follow: false, nocache: true, noarchive: true },
  }
}

export default async function LayoutDoLink({ children, params }: { children: React.ReactNode; params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = await lerLink(token)
  if (link.estado === 'invalido') notFound()

  if (link.estado === 'limitado') {
    return (
      <main className="mx-auto flex w-full max-w-[1160px] flex-1 flex-col items-center justify-center gap-2 px-5 py-16 text-center">
        <h1 className="font-heading text-2xl font-extrabold">Muitas visitas agora</h1>
        <p className="text-sm text-muted-foreground">Espere um minuto e tente de novo.</p>
      </main>
    )
  }

  const { resumo } = link
  const favoritos = await lerFavoritosDoLink(token)
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-3 px-5 py-4 lg:px-10">
          <div className="flex items-center gap-3">
            <Avatar apelido={resumo.apelido} nome={resumo.nome} url={resumo.avatar_url} size={56} />
            <div className="min-w-0">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">Coleção compartilhada</p>
              <h1 className="font-heading text-[26px] leading-tight font-extrabold tracking-tight text-foreground lg:text-[34px]">{resumo.nome}</h1>
              {resumo.apelido && <p className="text-sm text-muted-foreground">@{resumo.apelido}</p>}
            </div>
          </div>
          <VitrineNav base={`/c/${token}`} escopo={resumo.escopo} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1160px] flex-1 px-5 py-6 pb-[calc(24px+env(safe-area-inset-bottom))] lg:px-10">
        {/* Série abre a página da série dentro do link. Volume único fica sem link: a página do item é só do dono. */}
        <FaixaFavoritos favoritos={favoritos} hrefDoFavorito={(f) => (f.origem === 'serie' ? `/c/${token}/serie/${f.id}` : null)} className="mb-5" />
        {children}
      </main>
      <footer className="border-t border-border px-5 py-4 text-center text-xs text-muted-foreground">
        Somente leitura. Preço, loja e data de compra nunca são compartilhados.
      </footer>
    </div>
  )
}
