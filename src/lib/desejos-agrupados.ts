import type { TipoObra } from '@/lib/types'

/** O mínimo de um desejo que o agrupamento e a ordenação precisam enxergar. */
export type DesejoAgrupavel = {
  id: string
  titulo: string
  prioridade: number
  preco: number | null
  numero_volume: number | null
  serie: { id: string; nome: string; tipo: TipoObra; tem_numeracao: boolean } | null
}

export type GrupoDeDesejos<T extends DesejoAgrupavel> = {
  /** `id` da série; `null` no grupo "Avulsos". */
  serieId: string | null
  nome: string
  tipo: TipoObra | null
  itens: T[]
}

export type OrdemDesejos = 'prioridade' | 'preco' | 'recentes' | 'serie'

export const ORDENS_DESEJOS: { valor: OrdemDesejos; label: string }[] = [
  { valor: 'prioridade', label: 'Prioridade' },
  { valor: 'preco', label: 'Preço' },
  { valor: 'recentes', label: 'Mais recentes' },
  { valor: 'serie', label: 'Série' },
]

/** `?ordem=` da URL; qualquer valor desconhecido vale a ordem padrão (prioridade). */
export function lerOrdemDesejos(valor: string | undefined): OrdemDesejos {
  return ORDENS_DESEJOS.find((o) => o.valor === valor)?.valor ?? 'prioridade'
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })

function porNumero(a: DesejoAgrupavel, b: DesejoAgrupavel): number {
  // Sem número vai depois dos numerados.
  if (a.numero_volume === null && b.numero_volume === null) return collator.compare(a.titulo, b.titulo)
  if (a.numero_volume === null) return 1
  if (b.numero_volume === null) return -1
  return a.numero_volume - b.numero_volume || collator.compare(a.titulo, b.titulo)
}

/**
 * Ordena os desejos já filtrados. `prioridade` e `recentes` já chegam na ordem certa do banco
 * (a ordenação estável as preserva); aqui só se acertam o que o banco não resolve:
 * - `preco`: do mais caro ao mais barato, SEM preço por último (no banco, `desc` põe os nulos antes);
 * - `serie`: nome da série A–Z, Avulsos por último, e dentro da série pelo número do volume.
 */
export function ordenarDesejos<T extends DesejoAgrupavel>(itens: T[], ordem: OrdemDesejos): T[] {
  const copia = [...itens]
  if (ordem === 'preco') {
    return copia.sort((a, b) => {
      if (a.preco === null && b.preco === null) return 0
      if (a.preco === null) return 1
      if (b.preco === null) return -1
      return b.preco - a.preco
    })
  }
  if (ordem === 'serie') {
    return copia.sort((a, b) => {
      if (!a.serie && !b.serie) return collator.compare(a.titulo, b.titulo)
      if (!a.serie) return 1
      if (!b.serie) return -1
      return collator.compare(a.serie.nome, b.serie.nome) || porNumero(a, b)
    })
  }
  return copia
}

/**
 * Agrupa desejos por série.
 *
 * - Grupos: a série com mais desejos primeiro; empate pelo nome (A–Z). "Avulsos" (sem série) vai
 *   sempre por último, qualquer que seja o tamanho dele.
 * - Dentro do grupo: série numerada pelo `numero_volume` crescente; as demais mantêm a ordem em
 *   que chegaram (a ordenação escolhida pela pessoa).
 * - Só existe grupo com pelo menos um desejo.
 */
export function agruparDesejosPorSerie<T extends DesejoAgrupavel>(itens: T[]): GrupoDeDesejos<T>[] {
  const porSerie = new Map<string, GrupoDeDesejos<T>>()
  const numeradas = new Set<string>()
  const avulsos: T[] = []

  for (const item of itens) {
    if (!item.serie) {
      avulsos.push(item)
      continue
    }
    const grupo = porSerie.get(item.serie.id)
    if (grupo) grupo.itens.push(item)
    else {
      if (item.serie.tem_numeracao) numeradas.add(item.serie.id)
      porSerie.set(item.serie.id, {
        serieId: item.serie.id,
        nome: item.serie.nome,
        tipo: item.serie.tipo,
        itens: [item],
      })
    }
  }

  const grupos = Array.from(porSerie.values()).sort(
    (a, b) => b.itens.length - a.itens.length || collator.compare(a.nome, b.nome)
  )

  for (const grupo of grupos) {
    if (grupo.serieId && numeradas.has(grupo.serieId)) grupo.itens.sort(porNumero)
  }

  if (avulsos.length > 0) grupos.push({ serieId: null, nome: 'Avulsos', tipo: null, itens: avulsos })
  return grupos
}
