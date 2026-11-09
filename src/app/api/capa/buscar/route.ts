import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  aplicarCapaDeApi,
  buscarCapasDaComunidade,
  candidatosDaComunidade,
  chavesDoItem,
  memoriaGlobalDaSerie,
  registrarMemoriaGlobal,
} from '@/lib/capa-catalogo'
import { normalizarIsbn } from '@/lib/isbn'
import {
  buscarCandidatos,
  buscarCapaPorIsbn,
  type MemoriaSerie,
  type Provedor,
} from '@/lib/capa-busca'
import { normalizarTermoBusca } from '@/lib/capa-termo'
import { removerCapaAntiga } from '@/lib/supabase/capas'

const bodySchema = z.object({
  itemId: z.string().uuid(),
  isbn: z.string().trim().max(20).optional().nullable(),
  titulo: z.string().trim().min(1).max(300),
  tipo: z.enum(['hq', 'manga']),
})

type SerieRow = {
  id: string
  nome: string
  busca_termo: string | null
  busca_provedor: Provedor | null
  busca_ref: string | null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const json = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  }
  const { itemId, isbn, titulo, tipo } = parsed.data

  const { data: item } = await supabase
    .from('itens')
    .select('id, user_id, numero_volume, capa_url, serie:series(id, nome, busca_termo, busca_provedor, busca_ref)')
    .eq('id', itemId)
    .maybeSingle<{
      id: string
      user_id: string
      numero_volume: number | null
      capa_url: string | null
      serie: SerieRow | null
    }>()

  if (!item || item.user_id !== user.id) {
    return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 })
  }

  // Identificadores do item no catálogo (ISBN do item ou o informado, chave da edição, chave da série).
  const chaves = await chavesDoItem(supabase, itemId)
  const isbnDoItem = chaves?.isbn13 ?? (isbn ? normalizarIsbn(isbn) : null)
  const noCatalogo = await buscarCapasDaComunidade(supabase, chaves && { ...chaves, isbn13: isbnDoItem })

  // 1. Catálogo por ISBN: é a mesma edição, então aplica direto e não gasta chamada externa.
  const mesmaEdicaoPorIsbn = noCatalogo.find((c) => c.nivel === 'isbn')
  if (mesmaEdicaoPorIsbn) {
    const { error } = await supabase.rpc('capa_catalogo_aplicar', { p_item: itemId, p_capa: mesmaEdicaoPorIsbn.id })
    if (!error) {
      await removerCapaAntiga(supabase, item.capa_url, `pub/${mesmaEdicaoPorIsbn.caminho}`)
      return NextResponse.json({ status: 'aplicada', origem: 'comunidade' })
    }
    console.warn('[capa] não aplicou a capa do catálogo:', error.message)
  }

  // Título normalizado — reaproveita o nome da série (título "Série #N" sozinho
  // não é buscável) e o que já deu certo em volumes anteriores da mesma série.
  const termo = normalizarTermoBusca(titulo, item.serie?.nome, item.numero_volume)
  const memoriaPropria: MemoriaSerie | null = item.serie
    ? {
        termo: item.serie.busca_termo,
        provedor: item.serie.busca_provedor,
        ref: item.serie.busca_ref,
      }
    : null
  // Série que ninguém resolveu ainda neste usuário: tenta o que outros colecionadores já descobriram.
  const memoria = memoriaPropria?.provedor ? memoriaPropria : ((await memoriaGlobalDaSerie(supabase, chaves?.serieChave ?? null)) ?? memoriaPropria)

  // 2. Por ISBN nos provedores — melhor taxa de acerto, aplica direto sem ambiguidade
  if (isbnDoItem) {
    const resultado = await buscarCapaPorIsbn(isbnDoItem)
    if (resultado) {
      const path = await aplicarCapaDeApi(supabase, itemId, resultado.url)
      if (path) {
        await removerCapaAntiga(supabase, item.capa_url, path)
        if (item.serie) {
          await supabase
            .from('series')
            .update({
              busca_termo: termo.termo,
              busca_provedor: resultado.provedor,
              busca_ref: null,
              busca_atualizado_em: new Date().toISOString(),
            })
            .eq('id', item.serie.id)
          await registrarMemoriaGlobal(supabase, chaves?.serieChave ?? null, termo.termo, resultado.provedor, null)
        }
        return NextResponse.json({ status: 'aplicada' })
      }
    }
  }

  // 3. Por título — catálogo por chave, provedores e, no fim, capas que só batem no nome (nunca aplicadas sozinhas)
  const { candidatos, diagnostico } = await buscarCandidatos(termo, tipo, memoria, candidatosDaComunidade(noCatalogo))

  if (candidatos.length === 0) {
    return NextResponse.json({ status: 'nao_encontrada', diagnostico })
  }
  return NextResponse.json({ status: 'candidatos', candidatos, diagnostico })
}
