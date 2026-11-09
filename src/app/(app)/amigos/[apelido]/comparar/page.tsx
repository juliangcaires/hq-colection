import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Estrelas } from '@/components/ui/estrelas'
import { compararColecoes, type ItemParaComparar, type SerieEmComum } from '@/lib/comparar'
import { formatarFaixasDeVolumes } from '@/lib/faixas-volumes'
import { formatarNota } from '@/lib/nota'
import { lerTodasAsLinhas } from '@/lib/paginar'
import { carregarItens, carregarSeries } from '@/lib/vitrine'
import { lerAmigo } from '../dados'

export const metadata = { title: 'Comparar coleções' }

const POR_PAGINA_DO_AMIGO = 200
const MAX_PAGINAS_DO_AMIGO = 25

function Nota({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-1 text-warning-text">
      <Estrelas valor={valor} tamanho={12} mostrarValor={false} />
      <span className="font-semibold tabular-nums">{formatarNota(valor)}</span>
    </span>
  )
}

function CartaoDeSerie({ s }: { s: SerieEmComum }) {
  const faltaPraMim = s.eleTemEuNao.length > 0 || s.semNumeroEleTem > 0
  const faltaPraEle = s.euTenhoEleNao.length > 0 || s.semNumeroEuTenho > 0
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{s.meuNome}</p>
        {s.nomeDele !== s.meuNome && <p className="text-xs text-muted-foreground">Para ele: {s.nomeDele}</p>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Você tem</dt>
        <dd>{s.meusNumeros.length ? formatarFaixasDeVolumes(s.meusNumeros) : '—'}</dd>
        <dt className="text-muted-foreground">Ele tem</dt>
        <dd>{s.numerosDele.length ? formatarFaixasDeVolumes(s.numerosDele) : '—'}</dd>
      </dl>
      {faltaPraMim && (
        <p className="rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs text-warning-text">
          Ele tem e você não:{' '}
          {[s.eleTemEuNao.length ? s.eleTemEuNao.map((n) => `#${n}`).join(', ') : null, s.semNumeroEleTem ? `${s.semNumeroEleTem} sem número` : null].filter(Boolean).join(' · ')}
        </p>
      )}
      {faltaPraEle && (
        <p className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs text-link">
          Você tem e ele não:{' '}
          {[s.euTenhoEleNao.length ? s.euTenhoEleNao.map((n) => `#${n}`).join(', ') : null, s.semNumeroEuTenho ? `${s.semNumeroEuTenho} sem número` : null].filter(Boolean).join(' · ')}
        </p>
      )}
      {!faltaPraMim && !faltaPraEle && <p className="text-xs text-success-text">Vocês têm exatamente os mesmos volumes.</p>}
      {(s.notaMinha !== null || s.notaDele !== null) && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span>Nota da série — você: <Nota valor={s.notaMinha} /></span>
          <span>ele: <Nota valor={s.notaDele} /></span>
        </p>
      )}
      {s.notasPorVolume.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-link">Notas lado a lado ({s.notasPorVolume.length})</summary>
          <table className="mt-2 w-full">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">Volume</th>
                <th className="py-1 font-medium">Você</th>
                <th className="py-1 font-medium">Ele</th>
              </tr>
            </thead>
            <tbody>
              {s.notasPorVolume.map((n, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1">{n.numero !== null ? `#${n.numero}` : n.titulo}</td>
                  <td className="py-1"><Nota valor={n.minha} /></td>
                  <td className="py-1"><Nota valor={n.dele} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </li>
  )
}

export default async function CompararPage({ params }: { params: Promise<{ apelido: string }> }) {
  const { apelido } = await params
  const resumo = await lerAmigo(apelido)
  if (!resumo) return null
  if (!resumo.escopo.includes('colecao')) {
    return <p className="text-sm text-muted-foreground">{resumo.nome} não liberou a coleção, então não dá para comparar.</p>
  }

  const supabase = await createClient()
  const fonte = { tipo: 'amigo' as const, apelido }

  // Coleção do amigo (tudo o que o escopo dele libera), em páginas.
  const itensDele: ItemParaComparar[] = []
  for (let p = 0; p < MAX_PAGINAS_DO_AMIGO; p++) {
    const { itens, total } = await carregarItens(supabase, fonte, 'colecao', { limite: POR_PAGINA_DO_AMIGO, offset: p * POR_PAGINA_DO_AMIGO })
    itensDele.push(...itens.map((i) => ({ titulo: i.titulo, serie_nome: i.serie_nome, numero_volume: i.numero_volume, tipo: i.tipo, isbn13: i.isbn13, nota: i.nota })))
    if ((p + 1) * POR_PAGINA_DO_AMIGO >= total) break
  }
  const seriesDele = resumo.escopo.includes('series') ? await carregarSeries(supabase, fonte) : []

  // A minha: tudo o que eu tenho (desejo não conta).
  type LinhaMinha = { titulo: string; numero_volume: number | string | null; tipo: 'hq' | 'manga'; nota: number | string | null; serie: { nome: string } | null; edicao: { isbn13: string | null } | null }
  const minhas = await lerTodasAsLinhas<LinhaMinha>((de, ate) =>
    supabase
      .from('itens')
      .select('titulo, numero_volume, tipo, nota, serie:series(nome), edicao:edicoes(isbn13)')
      .neq('estado', 'desejo')
      .order('id')
      .range(de, ate) as unknown as PromiseLike<{ data: LinhaMinha[] | null; error: { message: string } | null }>
  )
  const { data: minhasSeries } = await supabase.from('series').select('nome, tipo, nota')

  const r = compararColecoes(
    {
      itens: minhas.map((i) => ({
        titulo: i.titulo,
        serie_nome: i.serie?.nome ?? null,
        numero_volume: i.numero_volume === null ? null : Number(i.numero_volume),
        tipo: i.tipo,
        isbn13: i.edicao?.isbn13 ?? null,
        nota: i.nota === null ? null : Number(i.nota),
      })),
      series: (minhasSeries ?? []).map((s) => ({ nome: s.nome as string, tipo: s.tipo as 'hq' | 'manga', nota: s.nota === null ? null : Number(s.nota) })),
    },
    { itens: itensDele, series: seriesDele.map((s) => ({ nome: s.nome, tipo: s.tipo, nota: s.nota })) }
  )
  const semNotasDele = !resumo.escopo.includes('notas_criticas')

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-xl font-bold">Você e {resumo.nome}</h2>
        <p className="text-sm text-muted-foreground">
          {r.emComum.length} {r.emComum.length === 1 ? 'série em comum' : 'séries em comum'}
          {r.livrosIguais > 0 ? ` · ${r.livrosIguais} ${r.livrosIguais === 1 ? 'livro idêntico (mesmo ISBN)' : 'livros idênticos (mesmo ISBN)'}` : ''}
          {' · '}só você: {r.soMinhas.length} · só ele: {r.soDele.length}
        </p>
        {semNotasDele && <p className="text-xs text-muted-foreground">As notas dele não aparecem porque ele não liberou &quot;Notas e críticas&quot; para amigos.</p>}
      </div>

      {r.emComum.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma série em comum ainda. A comparação junta séries pelo nome e pelo ISBN dos livros cadastrados.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {r.emComum.map((s) => (
            <CartaoDeSerie key={`${s.meuNome}|${s.tipo}`} s={s} />
          ))}
        </ul>
      )}

      {(r.soDele.length > 0 || r.soMinhas.length > 0) && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {r.soDele.length > 0 && (
            <details className="rounded-xl border border-border bg-card p-3 text-sm">
              <summary className="cursor-pointer font-medium">Séries que só ele tem ({r.soDele.length})</summary>
              <p className="mt-2 text-xs text-muted-foreground">{r.soDele.join(' · ')}</p>
            </details>
          )}
          {r.soMinhas.length > 0 && (
            <details className="rounded-xl border border-border bg-card p-3 text-sm">
              <summary className="cursor-pointer font-medium">Séries que só você tem ({r.soMinhas.length})</summary>
              <p className="mt-2 text-xs text-muted-foreground">{r.soMinhas.join(' · ')}</p>
            </details>
          )}
        </div>
      )}
      <Link href={`/amigos/${apelido}`} className="w-fit text-sm text-muted-foreground hover:text-foreground">
        ← Voltar para a coleção dele
      </Link>
    </section>
  )
}
