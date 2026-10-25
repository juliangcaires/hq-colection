import { ErroDeNegocio } from '@/lib/resultado'

/** Erros que as funções SQL (migration 0007) levantam de propósito, traduzidos para o usuário. */
export function lancarErroRpc(error: { message: string }): never {
  const m = error.message
  if (m === 'item_nao_encontrado') throw new ErroDeNegocio('Item não encontrado')
  if (m === 'serie_nao_encontrada') throw new ErroDeNegocio('Série não encontrada')
  if (m === 'tag_nao_encontrada') throw new ErroDeNegocio('Tag não encontrada')
  if (m.startsWith('volumes_repetidos:')) {
    const numeros = m
      .slice('volumes_repetidos:'.length)
      .split(',')
      .map((n) => `#${Number(n)}`)
      .join(', ')
    throw new ErroDeNegocio(`Esta série já tem ${numeros} — desmarque ou renumere`)
  }
  throw new Error(m)
}
