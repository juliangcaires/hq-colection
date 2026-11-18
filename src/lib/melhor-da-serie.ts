import type { EstadoItem } from '@/lib/types'

/**
 * "Melhor da série" (migration 0030): um volume lido por série, no item principal, e só quando a série
 * tem 2 ou mais volumes lidos (principais). A nota é opcional. O banco valida de novo; esta regra só decide
 * quando a tela mostra o botão.
 */
export type EntradaMelhor = {
  estado: EstadoItem
  serieId: string | null
  /** Id do volume normal quando este item é uma variante. */
  varianteDe: string | null
  /** Quantos volumes principais lidos a série tem (contando este). */
  lidosNaSerie: number
}

export function podeMarcarMelhor({ estado, serieId, varianteDe, lidosNaSerie }: EntradaMelhor): boolean {
  return estado === 'lido' && serieId !== null && varianteDe === null && lidosNaSerie >= 2
}

export const ROTULO_MELHOR = 'Melhor da série'
