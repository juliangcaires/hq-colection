import { agruparTagsPorTipo, TIPOS_TAG_DEDICADOS } from '@/lib/tags-por-tipo'
import type { Serie, TagLite } from '@/lib/types'

export type ResumoDaSerie = {
  /** Linhas "rótulo: valor". Só entra o que tem valor. */
  campos: { rotulo: string; valor: string }[]
  /** Tags agrupadas por tipo, na ordem do formulário. Tipo sem nenhuma tag não aparece. */
  tags: { tipo: string; rotulo: string; nomes: string[] }[]
  /** Observações da série (nunca compartilhadas); null quando vazias. */
  observacoes: string | null
}

/**
 * O que a página da série mostra em modo leitura (o formulário completo, com os campos vazios, fica no modal
 * "Editar"). Campo sem valor não entra: total de volumes em branco, observações vazias, tipo de tag sem tag.
 */
export function resumoDaSerie(
  serie: Pick<Serie, 'tipo' | 'total_volumes' | 'em_publicacao' | 'tem_numeracao' | 'observacoes'> & { tagIds: string[] },
  allTags: TagLite[]
): ResumoDaSerie {
  const campos: ResumoDaSerie['campos'] = [{ rotulo: 'Tipo', valor: serie.tipo === 'manga' ? 'Mangá' : 'HQ' }]
  if (serie.total_volumes !== null && serie.total_volumes !== undefined) {
    campos.push({ rotulo: 'Volumes', valor: String(serie.total_volumes) })
  }
  campos.push({ rotulo: 'Publicação', valor: serie.em_publicacao ? 'Em publicação' : 'Encerrada' })
  if (serie.tem_numeracao) campos.push({ rotulo: 'Numeração', valor: 'Numerada' })

  const grupos = agruparTagsPorTipo(serie.tagIds, allTags)
  const tags = TIPOS_TAG_DEDICADOS.filter(({ tipo }) => grupos[tipo].length > 0).map(({ tipo, label }) => ({
    tipo,
    rotulo: label,
    nomes: grupos[tipo].map((t) => t.nome),
  }))

  const obs = serie.observacoes?.trim()
  return { campos, tags, observacoes: obs ? obs : null }
}
