/**
 * Cálculo de "furos" (volumes faltantes) em uma série, a partir dos números
 * de volume já presentes na coleção do usuário.
 *
 * Regras:
 * - Só números de volume inteiros e positivos contam como "possuídos" para
 *   fins de furo (edições especiais com número fracionário, ex. 1.5, não
 *   preenchem nem geram furo).
 * - O teto da faixa considerada é `total_volumes` quando informado; caso
 *   contrário, usa-se o maior número de volume já presente na coleção (ex:
 *   tenho 1, 2, 4, 5 → falta o 3, mesmo sem `total_volumes` cadastrado).
 * - Sem nenhum volume inteiro na coleção não há como inferir nada: retorna [].
 *
 * Função pura — sem I/O — para ser fácil de testar isoladamente.
 */

const LIMITE_MAXIMO_FAIXA = 5000 // guarda-corpo contra total_volumes absurdo/errado

export function calcularVolumesFaltantes(
  numerosVolume: Array<number | null | undefined>,
  totalVolumes?: number | null
): number[] {
  const possuidos = new Set(
    numerosVolume.filter(
      (v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
    )
  )

  if (possuidos.size === 0) return []

  const maiorPossuido = Math.max(...possuidos)
  const limite =
    totalVolumes && totalVolumes > 0 ? Math.min(totalVolumes, LIMITE_MAXIMO_FAIXA) : maiorPossuido

  const faltantes: number[] = []
  for (let n = 1; n <= limite; n++) {
    if (!possuidos.has(n)) faltantes.push(n)
  }
  return faltantes
}
