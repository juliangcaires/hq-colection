/** Formata a nota no padrão brasileiro: 4,5 / 3. */
export function formatarNota(nota: number) {
  return nota.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}
