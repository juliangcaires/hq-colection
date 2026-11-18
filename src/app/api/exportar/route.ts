import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { lerTodasAsLinhas } from '@/lib/paginar'
import { gerarCsvDaColecao } from '@/lib/planilha'
import { paraItemAtual, SELECT_ITEM, type LinhaBanco } from '@/lib/importar-itens'

// Depende do usuário logado: nunca pode ser servido de cache.
export const dynamic = 'force-dynamic'

/** Baixa a coleção (e os desejos) do usuário logado em CSV UTF-8 com BOM, no mesmo layout que o importador lê. */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  // Só itens do próprio usuário (o filtro explícito vale mesmo que a RLS seja afrouxada um dia).
  const linhas = await lerTodasAsLinhas<LinhaBanco>((de, ate) =>
    supabase
      .from('itens')
      .select(SELECT_ITEM)
      .eq('user_id', user.id)
      .order('created_at')
      .order('id')
      .range(de, ate)
      .returns<LinhaBanco[]>()
  )

  const csv = gerarCsvDaColecao(linhas.map(paraItemAtual))
  const data = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="colecao-${data}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
