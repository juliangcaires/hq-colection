import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  baixarEPersistirCapa,
  buscarCandidatos,
  buscarCapaPorIsbn,
  type MemoriaSerie,
  type Provedor,
} from '@/lib/capa-busca'
import { normalizarTermoBusca } from '@/lib/capa-termo'

const bodySchema = z.object({
  itemId: z.string().uuid(),
  isbn: z.string().trim().optional().nullable(),
  titulo: z.string().trim().min(1),
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
    .select('id, user_id, numero_volume, serie:series(id, nome, busca_termo, busca_provedor, busca_ref)')
    .eq('id', itemId)
    .maybeSingle<{
      id: string
      user_id: string
      numero_volume: number | null
      serie: SerieRow | null
    }>()

  if (!item || item.user_id !== user.id) {
    return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 })
  }

  // Título normalizado — reaproveita o nome da série (título "Série #N" sozinho
  // não é buscável) e o que já deu certo em volumes anteriores da mesma série.
  const termo = normalizarTermoBusca(titulo, item.serie?.nome, item.numero_volume)
  const memoria: MemoriaSerie | null = item.serie
    ? {
        termo: item.serie.busca_termo,
        provedor: item.serie.busca_provedor,
        ref: item.serie.busca_ref,
      }
    : null

  // 1. Por ISBN — melhor taxa de acerto, aplica direto sem ambiguidade
  if (isbn) {
    const resultado = await buscarCapaPorIsbn(isbn)
    if (resultado) {
      const path = await baixarEPersistirCapa(supabase, user.id, itemId, resultado.url)
      if (path) {
        await supabase.from('itens').update({ capa_url: path, capa_origem: 'api' }).eq('id', itemId)
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
        }
        return NextResponse.json({ status: 'aplicada' })
      }
    }
  }

  // 2. Por título — cascata de provedores, acumulando candidatos

  const { candidatos, diagnostico } = await buscarCandidatos(termo, tipo, memoria)

  if (candidatos.length === 0) {
    return NextResponse.json({ status: 'nao_encontrada', diagnostico })
  }
  return NextResponse.json({ status: 'candidatos', candidatos, diagnostico })
}
