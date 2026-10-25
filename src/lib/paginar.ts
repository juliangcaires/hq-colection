/** Teto de linhas por resposta do PostgREST (`max-rows`); acima disso o `select` volta truncado, sem erro. */
export const TAMANHO_PAGINA = 1000

type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/**
 * Lê TODAS as linhas de uma consulta, página a página com `.range()`.
 *
 * `montar` recebe o intervalo e devolve a consulta já com ele aplicado. A consulta
 * precisa ter ordenação determinística (inclua uma coluna única), senão linhas
 * podem repetir ou sumir entre páginas.
 */
export async function lerTodasAsLinhas<T>(montar: (de: number, ate: number) => Pagina<T>): Promise<T[]> {
  const linhas: T[] = []
  for (let de = 0; ; de += TAMANHO_PAGINA) {
    const { data, error } = await montar(de, de + TAMANHO_PAGINA - 1)
    if (error) throw new Error(error.message)
    const pagina = data ?? []
    linhas.push(...pagina)
    if (pagina.length < TAMANHO_PAGINA) return linhas
  }
}
