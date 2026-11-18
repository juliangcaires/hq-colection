'use client'

import { alternarCurtidaDaLista, apagarComentarioDaLista, comentarNaLista, listarComentariosDaLista } from '@/app/(app)/listas/actions'
import { InteracaoSocial } from '@/components/feed/interacao-social'

const ACOES = {
  curtir: alternarCurtidaDaLista,
  comentar: comentarNaLista,
  apagarComentario: apagarComentarioDaLista,
  listarComentarios: listarComentariosDaLista,
}

/** Curtir e comentar uma lista (0028): a mesma conversa do feed, com as funções das listas. */
export function InteracaoDaLista({ listaId, curti, curtidas, comentarios }: { listaId: string; curti: boolean; curtidas: number; comentarios: number }) {
  return <InteracaoSocial alvoId={listaId} acoes={ACOES} curti={curti} curtidas={curtidas} comentarios={comentarios} />
}
