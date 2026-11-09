import { notFound } from 'next/navigation'
import { createAnonClient } from '@/lib/supabase/anon'
import { PaginaSerie } from '@/components/vitrine/paginas'
import { uuidOuNull } from '@/lib/filtros-url'
import { lerLink } from '../../dados'

export default async function PaginaDaSerie({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params
  const serieId = uuidOuNull(id)
  if (!serieId) notFound()
  const link = await lerLink(token)
  if (link.estado !== 'ok') return null
  const pagina = await PaginaSerie({ supabase: createAnonClient(), fonte: { tipo: 'link', token }, resumo: link.resumo, serieId })
  if (!pagina) notFound()
  return pagina
}
