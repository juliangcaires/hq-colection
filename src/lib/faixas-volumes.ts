/**
 * Leitura de faixas de volumes digitadas à mão: `1-3, 5-7, 10`.
 *
 * Existe porque comprar volume raramente é comprar UM volume, e quase nunca é
 * uma sequência limpa — o caso comum é "peguei do 1 ao 3, pulei o 4, e o 5 ao 7".
 * Um campo de texto cobre isso num gesto só; De/Até exigiria uma linha por buraco.
 *
 * Só inteiros positivos: edições fracionárias (1.5) não cabem numa faixa e
 * continuam sendo criadas uma a uma, como sempre foram.
 *
 * Função pura — sem I/O — para ser fácil de testar isoladamente.
 */

/** Mesmo teto do schema da action. Acima disso é dedo escorregando no teclado. */
export const MAX_VOLUMES_POR_LOTE = 200

export type FaixasLidas = { numeros: number[]; erro: string | null }

const VAZIO: FaixasLidas = { numeros: [], erro: null }

function erro(mensagem: string): FaixasLidas {
  return { numeros: [], erro: mensagem }
}

function lerInteiro(bruto: string): number | null {
  const limpo = bruto.trim()
  if (!/^\d+$/.test(limpo)) return null
  const n = Number(limpo)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export function parseFaixasDeVolumes(texto: string): FaixasLidas {
  const bruto = texto.trim()
  if (!bruto) return VAZIO

  const numeros = new Set<number>()

  for (const trecho of bruto.split(/[,;]/)) {
    const parte = trecho.trim()
    if (!parte) continue

    // En-dash entra junto porque é o que alguns teclados/autocorreções produzem.
    const faixa = parte.split(/\s*[-–]\s*/)
    if (faixa.length > 2) return erro(`"${parte}" não é uma faixa válida`)

    if (faixa.length === 1) {
      const n = lerInteiro(faixa[0])
      if (n === null) return erro(`"${parte}" não é um número de volume válido`)
      numeros.add(n)
      continue
    }

    const inicio = lerInteiro(faixa[0])
    const fim = lerInteiro(faixa[1])
    if (inicio === null || fim === null) return erro(`"${parte}" não é uma faixa válida`)
    if (inicio > fim) return erro(`Faixa invertida em "${parte}" — escreva ${fim}-${inicio}`)
    // Checar o tamanho da faixa ANTES de expandir: "1-999999" não pode virar array.
    if (fim - inicio + 1 > MAX_VOLUMES_POR_LOTE) {
      return erro(`"${parte}" passa de ${MAX_VOLUMES_POR_LOTE} volumes`)
    }

    for (let n = inicio; n <= fim; n++) numeros.add(n)
  }

  if (numeros.size === 0) return VAZIO
  if (numeros.size > MAX_VOLUMES_POR_LOTE) {
    return erro(`No máximo ${MAX_VOLUMES_POR_LOTE} volumes por vez`)
  }

  return { numeros: Array.from(numeros).sort((a, b) => a - b), erro: null }
}

/** Formata uma lista de números como `1-3, 5-7, 10` — o inverso do parser. */
export function formatarFaixasDeVolumes(numeros: number[]): string {
  const ordenados = Array.from(new Set(numeros)).sort((a, b) => a - b)
  const trechos: string[] = []

  let i = 0
  while (i < ordenados.length) {
    const inicio = ordenados[i]
    let fim = inicio
    while (i + 1 < ordenados.length && ordenados[i + 1] === fim + 1) {
      fim = ordenados[++i]
    }
    trechos.push(inicio === fim ? String(inicio) : `${inicio}-${fim}`)
    i++
  }

  return trechos.join(', ')
}
