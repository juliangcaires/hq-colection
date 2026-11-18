/**
 * Leitura do banco para o importador: carrega os itens do USUÁRIO que as linhas da planilha referenciam
 * (por `id` ou por ISBN) e classifica cada linha. Sem escrita. Usado pela prévia e pela aplicação, para as duas
 * enxergarem exatamente a mesma coisa.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { escaparLike } from '@/lib/like'
import { lerTodasAsLinhas } from '@/lib/paginar'
import { normalizarIsbn } from '@/lib/isbn'
import {
  casarLinha,
  chaveIsbn,
  limparCelula,
  linhaPlanilhaSchema,
  planejarAtualizacao,
  validarLinhaNova,
  type DadosNovos,
  type ItemAtual,
  type LinhaPlanilha,
  type PlanoAtualizacao,
} from '@/lib/planilha'
import type { EstadoItem, Tag, TipoObra } from '@/lib/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type LinhaBanco = {
  id: string
  titulo: string
  numero_volume: number | null
  tipo: TipoObra
  isbn: string | null
  estado: EstadoItem
  nota: number | null
  critica: string | null
  lido_em: string | null
  capa_url: string | null
  serie_id: string | null
  serie: { nome: string; serie_tags: { tags: Pick<Tag, 'nome' | 'tipo'> | null }[] | null } | null
  item_tags: { tags: Pick<Tag, 'nome' | 'tipo'> | null }[] | null
}

const SELECT_ITEM =
  'id, titulo, numero_volume, tipo, isbn, estado, nota, critica, lido_em, capa_url, serie_id, serie:series(nome, serie_tags(tags(nome, tipo))), item_tags(tags(nome, tipo))'

export function paraItemAtual(l: LinhaBanco): ItemAtual {
  const vistas = new Set<string>()
  const tags: ItemAtual['tags'] = []
  for (const rel of [...(l.item_tags ?? []), ...(l.serie?.serie_tags ?? [])]) {
    const t = rel.tags
    if (!t) continue
    const chave = `${t.tipo}:${t.nome.toLowerCase()}`
    if (vistas.has(chave)) continue
    vistas.add(chave)
    tags.push({ nome: t.nome, tipo: t.tipo })
  }
  return {
    id: l.id,
    titulo: l.titulo,
    numero_volume: l.numero_volume === null ? null : Number(l.numero_volume),
    tipo: l.tipo,
    isbn: l.isbn,
    estado: l.estado,
    nota: l.nota === null ? null : Number(l.nota),
    critica: l.critica,
    lido_em: l.lido_em,
    capa_url: l.capa_url,
    serie_id: l.serie_id,
    serieNome: l.serie?.nome ?? null,
    tags,
  }
}

export type LinhaClassificada =
  | { linha: number; tipo: 'erro'; motivo: string }
  | { linha: number; tipo: 'novo'; row: LinhaPlanilha; dados: DadosNovos }
  | { linha: number; tipo: 'atualizar'; item: ItemAtual; plano: PlanoAtualizacao }

/**
 * Valida e classifica as linhas do lote: erro (com motivo), novo ou atualização (com o diff).
 * Só itens com `user_id` = usuário entram nos mapas; id de terceiros cai em "não encontrado".
 */
export async function classificarLinhas(
  supabase: Cliente,
  userId: string,
  rowsBrutas: unknown[],
  primeiraLinha: number
): Promise<LinhaClassificada[]> {
  const saida: LinhaClassificada[] = []
  const validas: { linha: number; row: LinhaPlanilha }[] = []
  rowsBrutas.forEach((bruta, i) => {
    const linha = primeiraLinha + i
    const v = linhaPlanilhaSchema.safeParse(bruta)
    if (!v.success) {
      const p = v.error.issues[0]
      saida.push({ linha, tipo: 'erro', motivo: `${p.path.join('.') || 'linha'}: ${p.message}` })
      return
    }
    validas.push({ linha, row: v.data })
  })

  // 1) itens citados por id (só os do usuário)
  const ids = new Set<string>()
  const isbns = new Set<string>()
  for (const { row } of validas) {
    const id = limparCelula(row.id).toLowerCase()
    if (id) {
      if (UUID.test(id)) ids.add(id)
      continue
    }
    const isbn = normalizarIsbn(limparCelula(row.isbn))
    if (isbn) isbns.add(isbn)
  }

  // 2) itens do usuário com ISBN igual (a coluna guarda o texto como foi digitado: compara normalizado)
  const idsPorIsbn = new Map<string, string[]>()
  if (isbns.size > 0) {
    const comIsbn = await lerTodasAsLinhas<{ id: string; isbn: string }>((de, ate) =>
      supabase.from('itens').select('id, isbn').eq('user_id', userId).not('isbn', 'is', null).order('id').range(de, ate)
    )
    for (const { id, isbn } of comIsbn) {
      const chave = chaveIsbn(isbn)
      if (!chave || !isbns.has(chave)) continue
      idsPorIsbn.set(chave, [...(idsPorIsbn.get(chave) ?? []), id])
      ids.add(id)
    }
  }

  const porId = new Map<string, ItemAtual>()
  const lista = [...ids]
  for (let i = 0; i < lista.length; i += 100) {
    const { data, error } = await supabase
      .from('itens')
      .select(SELECT_ITEM)
      .eq('user_id', userId)
      .in('id', lista.slice(i, i + 100))
      .returns<LinhaBanco[]>()
    if (error) throw new Error(error.message)
    for (const l of data ?? []) porId.set(l.id, paraItemAtual(l))
  }
  const porIsbn = new Map<string, ItemAtual[]>()
  for (const [chave, itemIds] of idsPorIsbn) {
    porIsbn.set(chave, itemIds.map((id) => porId.get(id)).filter((x): x is ItemAtual => Boolean(x)))
  }

  for (const { linha, row } of validas) {
    const casamento = casarLinha(row, porId, porIsbn)
    if (casamento.tipo === 'erro') {
      saida.push({ linha, tipo: 'erro', motivo: casamento.motivo })
    } else if (casamento.tipo === 'atualizar') {
      const plano = planejarAtualizacao(row, casamento.item)
      if (!plano.ok) saida.push({ linha, tipo: 'erro', motivo: plano.motivo })
      else saida.push({ linha, tipo: 'atualizar', item: casamento.item, plano: plano.plano })
    } else {
      const novo = validarLinhaNova(row)
      if (!novo.ok) saida.push({ linha, tipo: 'erro', motivo: novo.motivo })
      else saida.push({ linha, tipo: 'novo', row, dados: novo.dados })
    }
  }
  return saida.sort((a, b) => a.linha - b.linha)
}

/** Série do usuário com este nome (sem criar nada), ou null. */
export async function buscarSerieIdPorNome(supabase: Cliente, userId: string, nome: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('series')
    .select('id')
    .eq('user_id', userId)
    .ilike('nome', escaparLike(nome.trim()))
    .order('created_at')
    .limit(1)
  if (error) throw new Error(error.message)
  return data && data.length > 0 ? data[0].id : null
}

/**
 * O item "novo" já existe? Mesma regra de sempre: com série, série + número; sem série, título (ignorando caixa)
 * + selo, porque edições diferentes do mesmo título são itens distintos.
 */
export async function itemJaExiste(
  supabase: Cliente,
  userId: string,
  alvo: { serieId: string | null; numeroVolume: number | null; titulo: string; selo: string | null }
): Promise<boolean> {
  if (alvo.serieId) {
    let q = supabase.from('itens').select('id').eq('user_id', userId).eq('serie_id', alvo.serieId)
    // `.eq(col, null)` nunca casa no PostgREST: linha sem volume precisa de `.is(col, null)`.
    q = alvo.numeroVolume === null ? q.is('numero_volume', null) : q.eq('numero_volume', alvo.numeroVolume)
    const { data, error } = await q.limit(1)
    if (error) throw new Error(error.message)
    return Boolean(data && data.length > 0)
  }
  const { data, error } = await supabase
    .from('itens')
    .select('id, item_tags(tags(nome, tipo))')
    .eq('user_id', userId)
    .is('serie_id', null)
    .ilike('titulo', escaparLike(alvo.titulo))
    .returns<{ id: string; item_tags: { tags: Pick<Tag, 'nome' | 'tipo'> | null }[] | null }[]>()
  if (error) throw new Error(error.message)
  return (data ?? []).some((c) => {
    const seloCandidato =
      (c.item_tags ?? [])
        .map((it) => it.tags)
        .find((t) => t?.tipo === 'selo')
        ?.nome.trim()
        .toLowerCase() || null
    return seloCandidato === alvo.selo
  })
}

export { SELECT_ITEM }
export type { LinhaBanco }
