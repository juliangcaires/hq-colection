import type { EstadoItem } from '@/lib/types'

/**
 * Cálculo de "furos" (volumes faltantes) em uma série.
 *
 * Regras:
 * - Só conta como POSSUÍDO o volume já adquirido (`comprado` ou `lido`). Item em
 *   `desejo` é exatamente o que ainda falta comprar — contá-lo como possuído
 *   sumiria com ele da lista de furos, que é para onde se olha na hora de comprar.
 * - Só números de volume inteiros e positivos entram na conta (edições especiais
 *   com número fracionário, ex. 1.5, não preenchem nem geram furo).
 * - O teto da faixa é `total_volumes` quando informado; caso contrário, o maior
 *   número CONHECIDO da série — incluindo os desejados, porque um volume na
 *   lista de desejos também é prova de que a série vai pelo menos até ali
 *   (ex: tenho 1 e 2, desejo o 5, sem `total_volumes` → faltam 3, 4 e 5).
 * - Sem nenhum volume inteiro conhecido não há como inferir nada: retorna [].
 *
 * Função pura — sem I/O — para ser fácil de testar isoladamente.
 */

const LIMITE_MAXIMO_FAIXA = 5000 // guarda-corpo contra total_volumes absurdo/errado

export type VolumeParaFuros = { numero_volume: number | null; estado: EstadoItem }

function ehInteiroPositivo(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

export function calcularVolumesFaltantes(
  volumes: VolumeParaFuros[],
  totalVolumes?: number | null
): number[] {
  const conhecidos = new Set<number>()
  const possuidos = new Set<number>()

  for (const { numero_volume, estado } of volumes) {
    if (!ehInteiroPositivo(numero_volume)) continue
    conhecidos.add(numero_volume)
    if (estado !== 'desejo') possuidos.add(numero_volume)
  }

  if (conhecidos.size === 0) return []

  const limite =
    totalVolumes && totalVolumes > 0
      ? Math.min(totalVolumes, LIMITE_MAXIMO_FAIXA)
      : Math.max(...conhecidos)

  const faltantes: number[] = []
  for (let n = 1; n <= limite; n++) {
    if (!possuidos.has(n)) faltantes.push(n)
  }
  return faltantes
}
