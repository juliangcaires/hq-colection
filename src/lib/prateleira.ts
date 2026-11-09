import type { CadastroIsbnInput, ReferenciaDeTag } from '@/lib/schemas'
import type { ConsultaIsbn } from '@/app/(app)/itens/isbn-actions'
import type { EstadoItem } from '@/lib/types'
import { normalizarTexto } from '@/lib/texto'

/**
 * Modo prateleira: vários ISBNs em sequência, revisão em lista e salvamento em lote.
 * Aqui ficam as regras puras (duplicatas, montagem do cadastro); a tela só desenha.
 */

export const NOVA_SERIE = '__nova__'
export const SEM_SERIE = '__nenhuma__'

export type StatusLinha = 'consultando' | 'ok' | 'nao_encontrado' | 'indisponivel' | 'erro' | 'salvo' | 'falhou'

export type LinhaPrateleira = {
  chave: string
  isbn13: string
  status: StatusLinha
  consulta: ConsultaIsbn | null
  titulo: string
  /** id de série existente, `NOVA_SERIE` ou `SEM_SERIE` (mesmo vocabulário do select da prévia). */
  serie: string
  incluir: boolean
  erro?: string
}

/** Motivo pelo qual a linha aparece marcada como duplicata (ou null). */
export type Duplicata = 'colecao' | 'repetido' | null

export function duplicataDaLinha(linha: LinhaPrateleira, anteriores: LinhaPrateleira[]): Duplicata {
  if (anteriores.some((a) => a.isbn13 === linha.isbn13 && a.status !== 'falhou')) return 'repetido'
  if ((linha.consulta?.jaNaColecao.length ?? 0) > 0) return 'colecao'
  return null
}

/** Duplicatas de cada linha, na ordem: a primeira ocorrência de um ISBN nunca é "repetida". */
export function marcarDuplicatas(linhas: LinhaPrateleira[]): Duplicata[] {
  return linhas.map((l, i) => duplicataDaLinha(l, linhas.slice(0, i)))
}

/** Linha entra no salvamento: marcada, ainda não salva, e com dados ou pelo menos um título digitado. */
export function linhaSalvavel(l: LinhaPrateleira): boolean {
  if (!l.incluir || l.status === 'salvo' || l.status === 'consultando') return false
  return l.status === 'ok' || l.titulo.trim().length > 0
}

export type OpcoesLote = {
  estado: EstadoItem
  /** Cria as tags de editora/autor sugeridas que ainda não existem (desligado por padrão). */
  criarTags: boolean
  /** Séries novas já criadas nesta sessão: nome normalizado → id (evita criar "One Piece" uma vez por volume). */
  seriesCriadas: ReadonlyMap<string, string>
}

export function montarCadastro(l: LinhaPrateleira, op: OpcoesLote): CadastroIsbnInput {
  const sug = l.consulta?.sugestoes ?? null
  const resultado = l.consulta?.resultado
  const edicao = resultado?.status === 'ok' ? resultado.edicao : null

  let serie: CadastroIsbnInput['serie'] = null
  if (l.serie === NOVA_SERIE && sug?.serieNovaNome) {
    const existente = op.seriesCriadas.get(normalizarTexto(sug.serieNovaNome))
    serie = existente ? { id: existente } : { nova: sug.serieNovaNome }
  } else if (l.serie !== SEM_SERIE && l.serie !== NOVA_SERIE) {
    serie = { id: l.serie }
  }

  return {
    isbn13: l.isbn13,
    edicaoId: resultado?.status === 'ok' ? resultado.edicaoId : null,
    titulo: l.titulo.trim(),
    tipo: edicao?.tipo ?? 'hq',
    estado: op.estado,
    numero_volume: edicao?.numero_volume ?? null,
    serie,
    editora: sug?.editora.tag
      ? { tagId: sug.editora.tag.id }
      : op.criarTags && sug?.editora.nomeParaCriar
        ? { criar: sug.editora.nomeParaCriar }
        : null,
    autores: (sug?.autores ?? []).flatMap((a): ReferenciaDeTag[] => (a.tag ? [{ tagId: a.tag.id }] : op.criarTags ? [{ criar: a.nome }] : [])),
  }
}

/** Divide em lotes para o servidor não segurar a requisição por minutos (cada item baixa uma capa). */
export function emLotes<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho))
  return lotes
}
