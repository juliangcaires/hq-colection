/**
 * Busca de capa para os volumes criados em lote.
 *
 * Roda no cliente, depois de a ação já ter terminado: capa é acessório e a
 * primeira busca de uma série é lenta (cascata de provedores). Deixar o botão
 * travado esperando N buscas seria pagar caro por algo que dá para resolver
 * depois, volume a volume, na tela do item.
 *
 * As buscas seguintes tendem a ser rápidas: a primeira que dá certo grava
 * `busca_termo`/`busca_provedor`/`busca_ref` na série (migration 0003), e o
 * resto do lote reaproveita. Daí a concorrência baixa — abrir 20 buscas de uma
 * vez desperdiçaria justamente essa memória, além de bater nos provedores.
 */

const CONCORRENCIA = 3

export type ItemParaCapa = { id: string; titulo: string; tipo: 'hq' | 'manga' }

export async function buscarCapasEmLote(itens: ItemParaCapa[]): Promise<number> {
  let cursor = 0
  let aplicadas = 0

  async function trabalhar() {
    while (cursor < itens.length) {
      const item = itens[cursor++]
      try {
        const res = await fetch('/api/capa/buscar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: item.id, isbn: null, titulo: item.titulo, tipo: item.tipo }),
        })
        const data: { status?: string } = await res.json()
        if (data.status === 'aplicada') aplicadas++
      } catch {
        // Volume já está criado; falhar a capa não desfaz nada.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCORRENCIA, itens.length) }, () => trabalhar())
  )

  return aplicadas
}
