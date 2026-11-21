import type { EstadoItem } from '@/lib/types'
import { rotuloDeVolume } from '@/lib/vitrine'

/**
 * "Li hoje": ler vários volumes de séries diferentes e dar nota e crítica a cada um, em sequência.
 * Aqui só a lógica pura (o que entra no lote, o passo a passo e o que vai para o banco); a tela está em
 * `components/itens/li-hoje.tsx` e a gravação (tudo ou nada) em `itens_marcar_lidos_lote` (migration 0035).
 */

export const MAX_VOLUMES_DO_LOTE = 100
export const MAX_CRITICA = 2000

/** Volume que a seleção do "Li hoje" mostra (vem de `buscarVolumesParaLiHoje`). */
export type VolumeDoLote = {
  id: string
  titulo: string
  serieNome: string | null
  numeroVolume: number | null
  capaUrl: string | null
  estado: EstadoItem
}

/** O que a pessoa digitou para um volume. Nota e crítica são opcionais. */
export type AvaliacaoDoVolume = { nota: number | null; critica: string; spoiler: boolean }

export const avaliacaoVazia = (): AvaliacaoDoVolume => ({ nota: null, critica: '', spoiler: false })

/** Mesma regra do "Marcar como lido" em lote: só volume comprado vira lido (desejo ainda não foi lido; lido já foi). */
export function podeEntrarNoLote(estado: EstadoItem): boolean {
  return estado === 'comprado'
}

/** Por que o volume não entra no lote (texto da tela), ou null quando entra. */
export function motivoDeFicarDeFora(estado: EstadoItem): string | null {
  if (estado === 'comprado') return null
  if (estado === 'lido') return 'Já está como lido'
  return 'Ainda é um desejo: marque como comprado antes'
}

/** "Berserk #3" / título quando não há série (o mesmo texto curto do card do feed). */
export function rotuloDoVolume(v: Pick<VolumeDoLote, 'titulo' | 'serieNome' | 'numeroVolume'>): string {
  const vol = rotuloDeVolume(v.numeroVolume)
  if (v.serieNome && vol && !v.titulo.includes(vol)) return `${v.serieNome} ${vol}`
  return v.titulo
}

/** Indicador do passo a passo: "2 de 5". */
export function indicadorDePasso(indice: number, total: number): string {
  return `${indice + 1} de ${total}`
}

export function ehUltimoPasso(indice: number, total: number): boolean {
  return indice >= total - 1
}

/** Passo seguinte / anterior, sem passar das pontas. */
export function proximoPasso(indice: number, total: number): number {
  return Math.min(indice + 1, Math.max(total - 1, 0))
}
export function passoAnterior(indice: number): number {
  return Math.max(indice - 1, 0)
}

/** Já tem nota ou crítica digitada em algum volume do lote (fechar o modal vai perder isso: pede confirmação). */
export function temAvaliacaoDigitada(avaliacoes: Record<string, AvaliacaoDoVolume>, ids?: string[]): boolean {
  const lista = ids ?? Object.keys(avaliacoes)
  return lista.some((id) => {
    const a = avaliacoes[id]
    return Boolean(a) && (a.nota !== null || a.critica.trim() !== '')
  })
}

export type ItemDoLote = { item_id: string; nota?: number; critica?: string; critica_spoiler?: boolean }

/**
 * O que vai para o banco, na ordem dos volumes do passo a passo. Volume sem nota nem crítica (ou "Pulado") vai só com o
 * id: o banco o marca como lido e mantém o que ele já tinha. Spoiler só vale com crítica.
 */
export function montarItensDoLote(ids: string[], avaliacoes: Record<string, AvaliacaoDoVolume>): ItemDoLote[] {
  return ids.map((id) => {
    const a = avaliacoes[id] ?? avaliacaoVazia()
    const critica = a.critica.trim()
    const item: ItemDoLote = { item_id: id }
    if (a.nota !== null) item.nota = a.nota
    if (critica) {
      item.critica = critica
      item.critica_spoiler = a.spoiler
    }
    return item
  })
}

/** Mensagem do aviso depois de gravar. */
export function mensagemDeConclusao(n: number): string {
  return n === 1 ? '1 volume marcado como lido' : `${n} volumes marcados como lidos`
}
