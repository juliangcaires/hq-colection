import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listarItem } from '@/lib/queries'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { ItemForm } from '@/components/itens/item-form'
import { uuidOuNull } from '@/lib/filtros-url'
import { ScrollRestore } from '@/components/ui/scroll-restore'
import { EmprestimoDoItem } from '@/components/emprestimos/emprestimo-do-item'
import { FUSO_DO_APP, hojeIso } from '@/lib/datas'
import { VarianteDoItem } from '@/components/itens/variante-do-item'
import type { CandidatoVariante } from '@/app/(app)/itens/actions'
import { AmigosDaObra } from '@/components/amigos/amigos-da-obra'
import { carregarEquivalencias, carregarObraAmigos } from '@/lib/notas-amigos'
import { VinculoDeObra } from '@/components/amigos/vinculo-de-obra'
import { completarChaves } from '@/lib/obra-chaves'
import { origemValida, vizinhosDeVolume } from '@/lib/navegacao-item'

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ de?: string | string[] }>
}) {
  const id = uuidOuNull((await params).id)
  if (!id) notFound()
  const origem = origemValida((await searchParams).de)
  const supabase = await createClient()

  const item = await listarItem(supabase, id)
  if (!item) notFound()

  const [{ data: seriesData }, capaMap, { data: emprestimo }, { data: irmaos }] = await Promise.all([
    supabase.from('series').select('id, nome').order('nome'),
    urlsDeCapas([item.capa_url]),
    // Só item que o dono tem pode ser emprestado; desejo nem consulta.
    item.estado === 'desejo'
      ? Promise.resolve({ data: null })
      : supabase.from('emprestimos').select('id, para_quem, emprestado_em, devolver_ate').eq('item_id', id).is('devolvido_em', null).maybeSingle(),
    // Volumes da mesma série (qualquer estado, desejo inclusive) para as setas anterior/próximo.
    item.serie && item.numero_volume !== null
      ? supabase.from('itens').select('id, numero_volume').eq('serie_id', item.serie.id).not('numero_volume', 'is', null)
      : Promise.resolve({ data: null }),
  ])

  // Variante (migration 0017): o volume normal deste item, ou as variantes dele; sem vínculo, sugere o mesmo
  // número na mesma série (a obra casada) como candidato a volume normal.
  const [{ data: principalRow }, { data: variantesRows }, { data: sugestoesRows }] = await Promise.all([
    item.variante_de
      ? supabase.from('itens').select('id, titulo, numero_volume, serie:series(nome)').eq('id', item.variante_de).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('itens').select('id, titulo, numero_volume, serie:series(nome)').eq('variante_de', id).order('created_at'),
    !item.variante_de && item.serie && item.numero_volume !== null
      ? supabase
          .from('itens')
          .select('id, titulo, numero_volume, capa_url, serie:series(nome)')
          .eq('serie_id', item.serie.id)
          .eq('numero_volume', item.numero_volume)
          .is('variante_de', null)
          .neq('id', id)
          .limit(5)
      : Promise.resolve({ data: null }),
  ])
  const ligado = (r: { id: string; titulo: string; numero_volume: number | string | null; serie: { nome: string } | { nome: string }[] | null }) => ({
    id: r.id,
    titulo: r.titulo,
    numero_volume: r.numero_volume === null ? null : Number(r.numero_volume),
    serie_nome: (Array.isArray(r.serie) ? r.serie[0]?.nome : r.serie?.nome) ?? null,
  })
  const sugestoes: CandidatoVariante[] = (sugestoesRows ?? []).map((r) => ({ ...ligado(r as never), capa_url: null }))

  // Notas dos amigos para a mesma obra (0019). Completa as chaves que faltam (itens antigos/importados) e, se este
  // item ainda não tinha, relê a dele. Falha aqui só some com o bloco, nunca derruba a página.
  await completarChaves(supabase)
  const { data: chaveRow } = await supabase.from('itens').select('obra_chave, edicao:edicoes(isbn13)').eq('id', id).maybeSingle()
  const edicaoRow = Array.isArray(chaveRow?.edicao) ? chaveRow?.edicao[0] : chaveRow?.edicao
  const isbnParaCasar = (edicaoRow as { isbn13?: string | null } | null | undefined)?.isbn13 ?? item.isbn ?? null
  const [amigos, vinculos] = await Promise.all([
    carregarObraAmigos(supabase, chaveRow?.obra_chave ?? null, isbnParaCasar).catch(() => []),
    carregarEquivalencias(supabase, chaveRow?.obra_chave ?? null).catch(() => []),
  ])

  const capaUrl = capaMap.get(item.capa_url ?? '') ?? null
  const vizinhos = vizinhosDeVolume(irmaos ?? [], item.id, item.numero_volume)

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-4">
      <ScrollRestore />
      {item.estado !== 'desejo' && <EmprestimoDoItem itemId={item.id} titulo={item.titulo} aberto={emprestimo} hoje={hojeIso(FUSO_DO_APP)} />}
      <VarianteDoItem
        key={JSON.stringify([item.id, item.variante_de, (variantesRows ?? []).length])}
        itemId={item.id}
        principal={principalRow ? ligado(principalRow as never) : null}
        variantes={(variantesRows ?? []).map((r) => ligado(r as never))}
        sugestoes={sugestoes}
      />
      <AmigosDaObra avaliacoes={amigos} rotulo="volume" />
      {chaveRow?.obra_chave && item.estado !== 'desejo' && <VinculoDeObra itemId={item.id} obraChave={chaveRow.obra_chave} vinculos={vinculos} />}
      {/* key: depois de salvar (ou de adquirir / marcar como lido) o formulário recomeça dos valores do banco, sem
          remontar quando só a capa muda (busca/upload de capa não pode apagar edição em andamento). */}
      <ItemForm
        key={JSON.stringify([item.id, item.updated_at, item.estado, item.nota, item.critica, item.lido_em, item.titulo, item.preco, item.loja, item.data_aquisicao, item.prioridade])}
        item={item} capaUrl={capaUrl}
        series={seriesData ?? []}
        origem={origem}
        volumeAnteriorId={vizinhos.anterior?.id ?? null}
        volumeProximoId={vizinhos.proximo?.id ?? null}
      />
    </div>
  )
}
