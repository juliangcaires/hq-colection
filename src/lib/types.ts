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
  editora: string | null
  total_volumes: number | null
  em_publicacao: boolean
  observacoes: string | null
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
  preco: number | null
  loja: string | null
  data_aquisicao: string | null
  nota: number | null
  observacoes: string | null
  created_at: string
  updated_at: string
}

export type ItemComRelacoes = Item & {
  serie: Pick<Serie, 'id' | 'nome' | 'editora' | 'tipo'> | null
  /** tags marcadas diretamente no item */
  tagsItem: Tag[]
  /** tags herdadas da série (vazio se não houver série) */
  tagsSerie: Tag[]
  /** união de tagsItem + tagsSerie, sem duplicar — use para exibir/filtrar */
  tagsEfetivas: Tag[]
}
