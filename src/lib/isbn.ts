/**
 * ISBN: limpeza, validação do dígito verificador e conversão ISBN-10 → ISBN-13.
 * Funções puras. A regra do ISBN-13 é a mesma de `isbn13_valido` na migration 0011.
 */

/** Tira hífens, espaços e qualquer ruído; mantém dígitos e o `X` final do ISBN-10 (sempre maiúsculo). */
export function limparIsbn(entrada: string): string {
  return entrada.replace(/[^0-9Xx]/g, '').toUpperCase()
}

export function isbn10Valido(isbn10: string): boolean {
  if (!/^[0-9]{9}[0-9X]$/.test(isbn10)) return false
  let soma = 0
  for (let i = 0; i < 10; i++) {
    const c = isbn10[i]
    soma += (c === 'X' ? 10 : Number(c)) * (10 - i)
  }
  return soma % 11 === 0
}

function digitoVerificador13(primeiros12: string): number {
  let soma = 0
  for (let i = 0; i < 12; i++) soma += Number(primeiros12[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (soma % 10)) % 10
}

export function isbn13Valido(isbn13: string): boolean {
  if (!/^97[89][0-9]{10}$/.test(isbn13)) return false
  return digitoVerificador13(isbn13.slice(0, 12)) === Number(isbn13[12])
}

/** ISBN-10 válido → ISBN-13 equivalente (prefixo 978 e novo dígito verificador); null se inválido. */
export function isbn10ParaIsbn13(isbn10: string): string | null {
  if (!isbn10Valido(isbn10)) return null
  const base = `978${isbn10.slice(0, 9)}`
  return `${base}${digitoVerificador13(base)}`
}

/** ISBN-13 com prefixo 978 → ISBN-10 equivalente; null para 979 (não tem ISBN-10) ou inválido. */
export function isbn13ParaIsbn10(isbn13: string): string | null {
  if (!isbn13Valido(isbn13) || !isbn13.startsWith('978')) return null
  const base = isbn13.slice(3, 12)
  let soma = 0
  for (let i = 0; i < 9; i++) soma += Number(base[i]) * (10 - i)
  const resto = (11 - (soma % 11)) % 11
  return `${base}${resto === 10 ? 'X' : resto}`
}

/**
 * Normaliza o que a pessoa digitou ou escaneou para ISBN-13, ou null se não for um ISBN válido
 * (comprimento errado, dígito verificador errado). Aceita hífens e ISBN-10.
 */
export function normalizarIsbn(entrada: string): string | null {
  if (entrada.length > 40) return null
  const limpo = limparIsbn(entrada)
  if (limpo.length === 13) return isbn13Valido(limpo) ? limpo : null
  if (limpo.length === 10) return isbn10ParaIsbn13(limpo)
  return null
}

/** Código lido pela câmera: só EAN-13 de ISBN (978/979) com dígito verificador certo. */
export function codigoDeBarrasEhIsbn(codigo: string): boolean {
  return /^97[89][0-9]{10}$/.test(codigo) && isbn13Valido(codigo)
}
