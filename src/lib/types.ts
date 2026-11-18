export type TipoObra = 'hq' | 'manga'
export type EstadoItem = 'desejo' | 'comprado' | 'lido'
export type TipoTag = 'personagem' | 'editora' | 'arco' | 'selo' | 'autor' | 'universo' | 'outro'
export type OrigemCapa = 'api' | 'foto' | 'nenhuma'

export type Tag = {
  id: string
  user_id: string
  nome: string
  tipo: TipoTag
  cor: string | null
  created_at: string
}

/** Forma leve de Tag, usada em resultados de busca/autocomplete que não trazem todas as colunas. */
export type TagLite = Pick<Tag, 'id' | 'nome' | 'tipo' | 'cor'>

export type Serie = {
  id: string
  user_id: string
  nome: string
  tipo: TipoObra
  total_volumes: number | null
  em_publicacao: boolean
  /** Série numerada: exige `numero_volume` único em todo volume incluído por "Adicionar volumes". */
  tem_numeracao: boolean
  observacoes: string | null
  /** Nota própria da série (0,5–5). Null = vale a média dos volumes lidos. */
  nota: number | null
  critica: string | null
  /** Crítica da série privada: nunca aparece em link nem para amigos. */
  critica_privada: boolean
  /** memória de busca de capa — o que já deu certo num volume desta série */
  busca_termo: string | null
  busca_provedor: string | null
  busca_ref: string | null
  busca_atualizado_em: string | null
  created_at: string
  updated_at: string
}

export type SerieComTags = Serie & { tags: Tag[] }

export type Item = {
  id: string
  user_id: string
  serie_id: string | null
  titulo: string
  numero_volume: number | null
  tipo: TipoObra
  isbn: string | null
  estado: EstadoItem
  prioridade: number
  capa_url: string | null
  capa_origem: OrigemCapa
  /** Quando a capa vem do catálogo público (`capa_url` começa com `pub/`). */
  capa_catalogo_id: string | null
  preco: number | null
  loja: string | null
  data_aquisicao: string | null
  nota: number | null
  critica: string | null
  /** Crítica privada: nunca aparece em link nem para amigos. */
  critica_privada: boolean
  /** Crítica com spoiler: para os outros ela aparece num cartão recolhido (0024); para você, normal, com selo. */
  critica_spoiler: boolean
  /** Melhor volume da série (0030): no máximo um por série, só em volume lido e principal. */
  melhor_da_serie: boolean
  /** Data em que virou lido (AAAA-MM-DD); null em item não lido ou lido antes da coluna existir. */
  lido_em: string | null
  /** Quando preenchido, este item é uma variante (outra capa/edição) do volume `variante_de`: compartilham lido, nota e crítica. */
  variante_de: string | null
  created_at: string
  updated_at: string
}

export type ItemComRelacoes = Item & {
  serie: Pick<Serie, 'id' | 'nome' | 'tipo' | 'tem_numeracao'> | null
  /** tags marcadas diretamente no item */
  tagsItem: Tag[]
  /** tags herdadas da série (vazio se não houver série) */
  tagsSerie: Tag[]
  /** união de tagsItem + tagsSerie, sem duplicar — use para exibir/filtrar */
  tagsEfetivas: Tag[]
}
