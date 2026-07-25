import type { TagLite, TipoTag } from '@/lib/types'

export const TIPOS_TAG_DEDICADOS: { tipo: TipoTag; label: string; multiple: boolean }[] = [
  { tipo: 'editora', label: 'Editora', multiple: false },
  { tipo: 'personagem', label: 'Personagem', multiple: true },
  { tipo: 'arco', label: 'Arco', multiple: true },
  { tipo: 'selo', label: 'Selo', multiple: true },
  { tipo: 'autor', label: 'Autor', multiple: true },
  { tipo: 'universo', label: 'Universo', multiple: true },
  { tipo: 'outro', label: 'Outras tags', multiple: true },
]

export function agruparTagsPorTipo(
  tagIds: string[],
  allTags: TagLite[]
): Record<TipoTag, TagLite[]> {
  const byId = new Map(allTags.map((t) => [t.id, t]))
  const grupos: Record<TipoTag, TagLite[]> = {
    personagem: [],
    editora: [],
    arco: [],
    selo: [],
    autor: [],
    universo: [],
    outro: [],
  }
  for (const id of tagIds) {
    const tag = byId.get(id)
    if (tag) grupos[tag.tipo].push(tag)
  }
  return grupos
}

/** Lê os filtros de tag por tipo a partir dos searchParams da URL (ids separados por vírgula). */
export function parseTagsPorTipoDaUrl(
  params: Record<string, string | undefined>
): Partial<Record<TipoTag, string[]>> {
  const resultado: Partial<Record<TipoTag, string[]>> = {}
  for (const { tipo } of TIPOS_TAG_DEDICADOS) {
    const raw = params[tipo]
    if (raw) resultado[tipo] = raw.split(',').filter(Boolean)
  }
  return resultado
}
