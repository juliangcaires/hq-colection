'use client'

import { alternarCurtida, apagarComentario, comentar, listarComentarios } from '@/app/(app)/feed/actions'
import { InteracaoSocial } from '@/components/feed/interacao-social'

const ACOES = { curtir: alternarCurtida, comentar, apagarComentario, listarComentarios }

/**
 * Curtir e comentar uma avaliação (o alvo é o item). Usado no feed e na lista de amigos da obra:
 * mesmas tabelas e mesmas funções do banco (0018), nada duplicado.
 */
export function InteracaoDoItem({ itemId, curti, curtidas, comentarios }: { itemId: string; curti: boolean; curtidas: number; comentarios: number }) {
  return <InteracaoSocial alvoId={itemId} acoes={ACOES} curti={curti} curtidas={curtidas} comentarios={comentarios} />
}
