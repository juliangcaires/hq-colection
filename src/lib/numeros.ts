/**
 * Lê um número digitado em formato brasileiro ou internacional.
 *
 * Aceita `1,5`, `1.5`, `1.234,56`, `1,234.56` e `1.234.567`; `null` para vazio ou
 * inválido (`abc`, `1e3`, `1,2,3`). Existe porque `Number('1,5')` dá `NaN` e o teclado
 * numérico pt-BR digita vírgula. Use `numeroInvalido` para distinguir vazio de inválido.
 */
export function parseNumeroPtBr(bruto: string): number | null {
  const texto = bruto.trim().replace(/\s/g, '')
  if (!texto) return null

  const virgula = texto.lastIndexOf(',')
  const ponto = texto.lastIndexOf('.')
  let normalizado: string
  if (virgula >= 0 && ponto >= 0) {
    // O separador que vem por último é o decimal; o outro é milhar.
    normalizado =
      virgula > ponto ? texto.replace(/\./g, '').replace(',', '.') : texto.replace(/,/g, '')
  } else if (virgula >= 0) {
    if (texto.indexOf(',') !== virgula) return null // 1,2,3
    normalizado = texto.replace(',', '.')
  } else if (ponto >= 0 && texto.indexOf('.') !== ponto) {
    normalizado = texto.replace(/\./g, '') // 1.234.567 (milhar)
  } else {
    normalizado = texto
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return null
  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/** Texto preenchido que não vira número (distingue "vazio" de "digitou errado"). */
export function numeroInvalido(bruto: string): boolean {
  return bruto.trim() !== '' && parseNumeroPtBr(bruto) === null
}
