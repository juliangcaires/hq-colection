import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listarItem } from '@/lib/queries'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { ItemForm } from '@/components/itens/item-form'
import { uuidOuNull } from '@/lib/filtros-url'
import { ScrollRestore } from '@/components/ui/scroll-restore'
import { EmprestimoDoItem } from '@/components/emprestimos/emprestimo-do-item'
import { FUSO_DO_APP, hojeIso } from '@/lib/datas'

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const id = uuidOuNull((await params).id)
  if (!id) notFound()
  const supabase = await createClient()

  const item = await listarItem(supabase, id)
  if (!item) notFound()

  const [{ data: seriesData }, capaMap, { data: emprestimo }] = await Promise.all([
    supabase.from('series').select('id, nome').order('nome'),
    urlsDeCapas([item.capa_url]),
    // Só item que o dono tem pode ser emprestado; desejo nem consulta.
    item.estado === 'desejo'
      ? Promise.resolve({ data: null })
      : supabase.from('emprestimos').select('id, para_quem, emprestado_em, devolver_ate').eq('item_id', id).is('devolvido_em', null).maybeSingle(),
  ])

  const capaUrl = capaMap.get(item.capa_url ?? '') ?? null

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-4">
      <ScrollRestore />
      {item.estado !== 'desejo' && <EmprestimoDoItem itemId={item.id} titulo={item.titulo} aberto={emprestimo} hoje={hojeIso(FUSO_DO_APP)} />}
      {/* key: depois de salvar (ou de adquirir / marcar como lido) o formulário recomeça dos valores do banco, sem
          remontar quando só a capa muda (busca/upload de capa não pode apagar edição em andamento). */}
      <ItemForm
        key={JSON.stringify([item.updated_at, item.estado, item.nota, item.critica, item.lido_em, item.titulo, item.preco, item.loja, item.data_aquisicao, item.prioridade])}
        item={item} capaUrl={capaUrl}
        series={seriesData ?? []}
      />
    </div>
  )
}
