import Link from 'next/link'
import { notFound } from 'next/navigation'
import { lerAmigo } from './dados'
import { VitrineNav } from '@/components/vitrine/vitrine-nav'

export default async function LayoutDoAmigo({ children, params }: { children: React.ReactNode; params: Promise<{ apelido: string }> }) {
  const { apelido } = await params
  const resumo = await lerAmigo(apelido)
  if (!resumo) notFound()

  return (
    <div className="flex flex-col gap-5">
      <Link href="/amigos" className="w-fit text-sm text-muted-foreground hover:text-foreground">
        ← Amigos
      </Link>
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="font-heading text-[28px] leading-tight font-extrabold tracking-tight text-foreground lg:text-[36px]">{resumo.nome}</h1>
          {resumo.apelido && <p className="text-sm text-muted-foreground">@{resumo.apelido}</p>}
        </div>
        <VitrineNav base={`/amigos/${resumo.apelido ?? apelido}`} escopo={resumo.escopo} extras={[{ href: `/amigos/${resumo.apelido ?? apelido}/comparar`, rotulo: 'Comparar' }]} />
      </header>
      {children}
    </div>
  )
}
