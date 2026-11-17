import type { SupabaseClient } from '@supabase/supabase-js'
import { chaveObra, chaveSerie } from '@/lib/texto'

/**
 * Chaves de identidade da obra e da série entre usuários (migration 0019). Calculadas aqui (a normalização
 * depende de `texto.ts`) e gravadas em `itens.obra_chave` / `series.serie_chave`. Tudo é "melhor esforço":
 * falhar aqui nunca derruba um salvamento; a chave é refeita na próxima oportunidade.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

type LinhaItem = { id: string; titulo: string; numero_volume: number | string | null; tipo: 'hq' | 'manga'; obra_chave: string | null; serie: { nome: string } | { nome: string }[] | null }

const COLUNAS_ITEM = 'id, titulo, numero_volume, tipo, obra_chave, serie:series(nome)'
const LOTE = 200
const PARALELO = 10

function chaveDoItem(r: LinhaItem): string {
  const serie = Array.isArray(r.serie) ? r.serie[0]?.nome : r.serie?.nome
  return chaveObra({ serie: serie ?? null, numero: r.numero_volume === null ? null : Number(r.numero_volume), titulo: r.titulo, tipo: r.tipo })
}

async function emLotes<T>(itens: T[], fn: (x: T) => PromiseLike<unknown>) {
  for (let i = 0; i < itens.length; i += PARALELO) await Promise.all(itens.slice(i, i + PARALELO).map(fn))
}

async function gravarItens(supabase: Cliente, linhas: LinhaItem[]) {
  await emLotes(linhas.filter((r) => chaveDoItem(r) !== r.obra_chave), (r) =>
    supabase.from('itens').update({ obra_chave: chaveDoItem(r) }).eq('id', r.id)
  )
}

/** Recalcula a chave de um item (depois de salvar). */
export async function gravarChaveDoItem(supabase: Cliente, itemId: string): Promise<void> {
  try {
    const { data } = await supabase.from('itens').select(COLUNAS_ITEM).eq('id', itemId).maybeSingle()
    if (data) await gravarItens(supabase, [data as LinhaItem])
  } catch {
    // acessório
  }
}

/** Recalcula a chave da série e a dos volumes dela (o nome ou o tipo podem ter mudado). */
export async function gravarChaveDaSerie(supabase: Cliente, serieId: string): Promise<void> {
  try {
    const { data: s } = await supabase.from('series').select('id, nome, tipo, serie_chave').eq('id', serieId).maybeSingle()
    if (!s) return
    const chave = chaveSerie(s.nome, s.tipo)
    if (chave !== s.serie_chave) await supabase.from('series').update({ serie_chave: chave }).eq('id', serieId)
    const { data: itens } = await supabase.from('itens').select(COLUNAS_ITEM).eq('serie_id', serieId).limit(2000)
    await gravarItens(supabase, (itens ?? []) as LinhaItem[])
  } catch {
    // acessório
  }
}

/**
 * Completa as chaves que faltam (itens e séries salvos antes da 0019 ou por caminhos que não passam pelo
 * formulário: importação, volumes em lote). Um lote por chamada; chame de páginas que já carregam dados.
 * Devolve quantos registros preencheu.
 */
export async function completarChaves(supabase: Cliente, limite = LOTE): Promise<number> {
  try {
    const [{ data: itens }, { data: series }] = await Promise.all([
      supabase.from('itens').select(COLUNAS_ITEM).is('obra_chave', null).limit(limite),
      supabase.from('series').select('id, nome, tipo').is('serie_chave', null).limit(limite),
    ])
    await Promise.all([
      gravarItens(supabase, (itens ?? []) as LinhaItem[]),
      emLotes(series ?? [], (s: { id: string; nome: string; tipo: 'hq' | 'manga' }) =>
        supabase.from('series').update({ serie_chave: chaveSerie(s.nome, s.tipo) }).eq('id', s.id)
      ),
    ])
    return (itens?.length ?? 0) + (series?.length ?? 0)
  } catch {
    return 0
  }
}
