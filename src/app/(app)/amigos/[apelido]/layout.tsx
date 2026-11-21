import Link from 'next/link'
import { notFound } from 'next/navigation'
import { lerAmigo } from './dados'
import { Avatar } from '@/components/ui/avatar'
import { VitrineNav } from '@/components/vitrine/vitrine-nav'

export default async function LayoutDoAmigo({ children, params }: { children: React.ReactNode; params: Promise<{ apelido: string }> }) {
  const { apelido } = await params
  const resumo = await lerAmigo(apelido)
  if (!resumo) notFound()
  const base = `/amigos/${resumo.apelido ?? apelido}`

  return (
    <div className="flex flex-col gap-5">
      <Link href="/amigos" className="w-fit text-sm text-muted-foreground hover:text-foreground">
        ← Amigos
      </Link>
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Avatar apelido={resumo.apelido} nome={resumo.nome} url={resumo.avatar_url} size={56} />
          <div className="min-w-0">
            <h1 className="font-heading text-[28px] leading-tight font-extrabold tracking-tight text-foreground lg:text-[36px]">{resumo.nome}</h1>
            {resumo.apelido && <p className="text-sm text-muted-foreground">@{resumo.apelido}</p>}
          </div>
        </div>
        <VitrineNav base={`/amigos/${resumo.apelido ?? apelido}`} escopo={resumo.escopo} extras={[
            { href: `${base}/listas`, rotulo: 'Listas' },
            { href: `${base}/comparar`, rotulo: 'Comparar' },
          ]} />
      </header>
      {children}
    </div>
  )
}
