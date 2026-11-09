import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import { urlsDeCapas } from '@/lib/supabase/capas'
import { BotaoDevolver } from '@/components/emprestimos/botao-devolver'
import { Badge } from '@/components/ui/badge'
import { FUSO_DO_APP, hojeIso } from '@/lib/datas'
import { situacaoDoEmprestimo, textoDoPrazo } from '@/lib/emprestimos'

export const metadata = { title: 'Empréstimos' }

type Linha = {
  id: string
  item_id: string
  para_quem: string
  emprestado_em: string
  devolver_ate: string | null
  devolvido_em: string | null
  observacao: string | null
  item: { titulo: string; capa_url: string | null; numero_volume: number | null; serie: { nome: string } | null } | null
}

const COLUNAS = 'id, item_id, para_quem, emprestado_em, devolver_ate, devolvido_em, observacao, item:itens(titulo, capa_url, numero_volume, serie:series(nome))'
const dataBr = (d: string) => d.split('-').reverse().join('/')

export default async function EmprestimosPage() {
  const supabase = await createClient()
  const hoje = hojeIso(FUSO_DO_APP)
  const [abertosRes, devolvidosRes] = await Promise.all([
    supabase.from('emprestimos').select(COLUNAS).is('devolvido_em', null).order('devolver_ate', { ascending: true, nullsFirst: false }).order('emprestado_em').limit(200).overrideTypes<Linha[], { merge: false }>(),
    supabase.from('emprestimos').select(COLUNAS).not('devolvido_em', 'is', null).order('devolvido_em', { ascending: false }).limit(10).overrideTypes<Linha[], { merge: false }>(),
  ])
  if (abertosRes.error) throw new Error(abertosRes.error.message)
  const abertos = abertosRes.data ?? []
  const devolvidos = devolvidosRes.data ?? []
  const capas = urlsDeCapas([...abertos, ...devolvidos].map((e) => e.item?.capa_url ?? null))
  const atrasados = abertos.filter((e) => situacaoDoEmprestimo(e, hoje) === 'atrasado').length

  const Cartao = ({ e, devolvido }: { e: Linha; devolvido?: boolean }) => {
    const capa = capas.get(e.item?.capa_url ?? '') ?? null
    const situacao = situacaoDoEmprestimo(e, hoje)
    const sub = [e.item?.serie?.nome, e.item?.numero_volume != null ? `#${e.item.numero_volume}` : null].filter(Boolean).join(' ')
    return (
      <li className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
        <Link href={`/item/${e.item_id}`} className="flex min-w-0 flex-1 items-center gap-3">
          <div className="relative aspect-[2/3] w-11 shrink-0 overflow-hidden rounded bg-surface-2 ring-1 ring-white/10">
            {capa && <Image unoptimized src={capa} alt="" fill sizes="44px" className="object-cover" />}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-semibold text-foreground">{e.item?.titulo ?? 'Item removido'}</span>
            {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
            <span className="truncate text-xs text-muted-foreground">
              Para <strong className="text-foreground">{e.para_quem}</strong> · desde {dataBr(e.emprestado_em)}
              {devolvido && e.devolvido_em ? ` · devolvido em ${dataBr(e.devolvido_em)}` : ''}
            </span>
            {!devolvido && (
              <span className="flex items-center gap-1.5 text-xs">
                {situacao === 'atrasado' ? <Badge variant="destructive">{textoDoPrazo(e, hoje)}</Badge> : <span className="text-muted-foreground">{textoDoPrazo(e, hoje)}</span>}
                {e.devolver_ate && <span className="text-muted-foreground">({dataBr(e.devolver_ate)})</span>}
              </span>
            )}
            {e.observacao && <span className="line-clamp-1 text-xs text-muted-foreground">{e.observacao}</span>}
          </div>
        </Link>
        {!devolvido && <BotaoDevolver id={e.id} itemId={e.item_id} />}
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Empréstimos</h1>
        <p className="text-sm text-muted-foreground">
          {abertos.length === 0 ? 'Nada emprestado agora.' : `${abertos.length} ${abertos.length === 1 ? 'item emprestado' : 'itens emprestados'}`}
          {atrasados > 0 ? ` · ${atrasados} ${atrasados === 1 ? 'atrasado' : 'atrasados'}` : ''}. Para emprestar, abra o item e toque em &quot;Emprestar este item&quot;.
        </p>
      </div>
      {abertos.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Empréstimos em aberto">
          {abertos.map((e) => (
            <Cartao key={e.id} e={e} />
          ))}
        </ul>
      )}
      {devolvidos.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-heading text-lg font-bold">Devolvidos recentemente</h2>
          <ul className="flex flex-col gap-2">
            {devolvidos.map((e) => (
              <Cartao key={e.id} e={e} devolvido />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
