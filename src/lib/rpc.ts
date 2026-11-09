import { ErroDeNegocio } from '@/lib/resultado'

/** Erros que as funções SQL (migration 0007) levantam de propósito, traduzidos para o usuário. */
export function lancarErroRpc(error: { message: string }): never {
  const m = error.message
  if (m === 'item_nao_encontrado') throw new ErroDeNegocio('Item não encontrado')
  if (m === 'serie_nao_encontrada') throw new ErroDeNegocio('Série não encontrada')
  if (m === 'tag_nao_encontrada') throw new ErroDeNegocio('Tag não encontrada')
  if (m === 'apelido_nao_encontrado') throw new ErroDeNegocio('Não encontrei ninguém com esse apelido.')
  if (m === 'perfil_sem_apelido') throw new ErroDeNegocio('Defina o seu apelido em Configurações antes de adicionar amigos.')
  if (m === 'amizade_propria') throw new ErroDeNegocio('Você não pode adicionar a si mesmo.')
  if (m === 'amizade_existente') throw new ErroDeNegocio('Vocês já são amigos.')
  if (m === 'amizade_ja_solicitada') throw new ErroDeNegocio('Você já enviou um pedido para essa pessoa. Aguarde o aceite.')
  if (m === 'amizade_nao_encontrada') throw new ErroDeNegocio('Pedido de amizade não encontrado.')
  if (m === 'convite_invalido') throw new ErroDeNegocio('Este convite não vale mais (já foi usado ou expirou).')
  if (m === 'presente_ja_reservado') throw new ErroDeNegocio('Outro amigo já marcou este presente.')
  if (m === 'item_nao_possuido') throw new ErroDeNegocio('Só dá para emprestar um item que você tem.')
  if (m === 'emprestimo_em_aberto') throw new ErroDeNegocio('Este item já está emprestado. Marque a devolução antes de emprestar de novo.')
  if (m === 'emprestimo_nao_encontrado') throw new ErroDeNegocio('Empréstimo não encontrado ou já devolvido.')
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
