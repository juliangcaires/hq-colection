import { ErroDeNegocio } from '@/lib/resultado'

/** Erros que as funções SQL (migration 0007) levantam de propósito, traduzidos para o usuário. */
export function lancarErroRpc(error: { message: string }): never {
  const m = error.message
  if (m === 'item_nao_encontrado') throw new ErroDeNegocio('Item não encontrado')
  if (m === 'serie_nao_encontrada') throw new ErroDeNegocio('Série não encontrada')
  if (m === 'tag_nao_encontrada') throw new ErroDeNegocio('Tag não encontrada')
  if (m === 'escopo_invalido') throw new ErroDeNegocio('Escolha ao menos uma seção para compartilhar.')
  if (m === 'sem_link_ativo') throw new ErroDeNegocio('Você não tem um link ativo.')
  if (m === 'capa_indisponivel') throw new ErroDeNegocio('Esta capa não está mais disponível.')
  if (m === 'contribuicao_nao_autorizada') throw new ErroDeNegocio('Ative "Contribuir com as capas que eu enviar" nas configurações para compartilhar fotos.')
  if (m === 'nada_a_marcar') throw new ErroDeNegocio('Esta série não tem volumes comprados para marcar como lidos.')
  if (m === 'critica_longa') throw new ErroDeNegocio('A crítica passa de 2000 caracteres.')
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
