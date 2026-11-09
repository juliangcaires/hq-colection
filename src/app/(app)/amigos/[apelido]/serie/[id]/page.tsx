import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PaginaSerie } from '@/components/vitrine/paginas'
import { BotaoPresente } from '@/components/amigos/botao-presente'
import { uuidOuNull } from '@/lib/filtros-url'
import { lerAmigo } from '../../dados'

export default async function PaginaDaSerie({ params }: { params: Promise<{ apelido: string; id: string }> }) {
  const { apelido, id } = await params
  const serieId = uuidOuNull(id)
  if (!serieId) notFound()
  const resumo = await lerAmigo(apelido)
  if (!resumo) return null
  const pagina = await PaginaSerie({ supabase: await createClient(), fonte: { tipo: 'amigo', apelido }, resumo,
    serieId,
    acaoItem: (item) =>
      item.estado === 'desejo' ? <BotaoPresente itemId={item.id} apelido={apelido} reservado={item.reservado} reservadoPorMim={item.reservado_por_mim} /> : null,
  })
  if (!pagina) notFound()
  return pagina
}
