import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { baixarEPersistirCapa, buscarCapaPorIsbn, buscarCapaPorTitulo } from '@/lib/capa-busca'

const bodySchema = z.object({
  itemId: z.string().uuid(),
  isbn: z.string().trim().optional().nullable(),
  titulo: z.string().trim().min(1),
  tipo: z.enum(['hq', 'manga']),
})

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
    .select('id, user_id')
    .eq('id', itemId)
    .maybeSingle()

  if (!item || item.user_id !== user.id) {
    return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 })
  }

  // 1. Por ISBN — melhor taxa de acerto, aplica direto sem ambiguidade
  if (isbn) {
    const url = await buscarCapaPorIsbn(isbn)
    if (url) {
      const path = await baixarEPersistirCapa(supabase, user.id, itemId, url)
      if (path) {
        await supabase.from('itens').update({ capa_url: path, capa_origem: 'api' }).eq('id', itemId)
        return NextResponse.json({ status: 'aplicada' })
      }
    }
  }

  // 2. Por título — tende a ser ambíguo, devolve candidatos para o usuário escolher
  const candidatos = await buscarCapaPorTitulo(titulo, tipo)
  if (candidatos.length === 0) {
    return NextResponse.json({ status: 'nao_encontrada' })
  }
  return NextResponse.json({ status: 'candidatos', candidatos })
}
