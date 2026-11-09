import { createClient } from '@/lib/supabase/server'
import { PaginaDesejos } from '@/components/vitrine/paginas'
import { BotaoPresente } from '@/components/amigos/botao-presente'
import { lerLimite } from '@/lib/filtros-url'
import { lerAmigo } from '../dados'

export default async function Pagina({ params, searchParams }: { params: Promise<{ apelido: string }>; searchParams: Promise<{ limite?: string }> }) {
  const { apelido } = await params
  const resumo = await lerAmigo(apelido)
  if (!resumo) return null
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
        Marque &quot;Vou dar esse&quot; para os outros amigos saberem que o presente já está resolvido.{' '}
        <strong className="text-foreground">{resumo.nome} não vê essas marcações.</strong>
      </p>
      <PaginaDesejos
        supabase={await createClient()}
        fonte={{ tipo: 'amigo', apelido }}
        resumo={resumo}
        limite={lerLimite((await searchParams).limite)}
        acaoItem={(item) =>
          item.estado === 'desejo' ? (
            <BotaoPresente itemId={item.id} apelido={apelido} reservado={item.reservado} reservadoPorMim={item.reservado_por_mim} />
          ) : null
        }
      />
    </div>
  )
}
