import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { carregarEstatisticasDaPagina } from '@/lib/estatisticas-pagina'
import { carregarComparacaoComAmigos } from '@/lib/estatisticas'
import { nomeDoMes } from '@/lib/diario'
import { formatarNota } from '@/lib/nota'
import { Bloco, GraficoPorMes, ListaDeContagem, Numero, plural, SeletorDeAno } from '@/components/estatisticas/blocos'

function nomeDoMesPorNumero(ano: number, mes: number): string {
  return nomeDoMes(`${ano}-${String(mes).padStart(2, '0')}`)
}

export default async function EstatisticasPage({ searchParams }: { searchParams: Promise<{ ano?: string | string[] }> }) {
  const supabase = await createClient()
  const { ano, anos, semNenhumaLeitura, estatisticas: e, minhasNotasDoAno } = await carregarEstatisticasDaPagina(supabase, (await searchParams).ano)
  const amigos = e.vazio ? null : await carregarComparacaoComAmigos(supabase, minhasNotasDoAno)
  const seq = e.maiorSequencia

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-[28px] font-extrabold tracking-tight">Estatísticas</h1>
        <p className="text-sm text-muted-foreground">
          {e.vazio ? 'Seus números de leitura, ano a ano.' : `${plural(e.leituras, 'leitura', 'leituras')} em ${ano}.`}
        </p>
      </header>

      <SeletorDeAno anos={anos} ano={ano} rota="/estatisticas" />

      {e.vazio ? (
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          {semNenhumaLeitura
            ? 'Ainda não há leituras com data. Marque um volume como lido e os números aparecem aqui.'
            : `Nenhuma leitura em ${ano}. Escolha outro ano acima.`}
        </p>
      ) : (
        <>
          <Link
            href={`/estatisticas/ano?ano=${ano}`}
            className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm text-foreground"
          >
            <span className="flex items-center gap-2">
              <Sparkles className="size-4 text-link" aria-hidden /> Ver o seu {ano} em HQ
            </span>
            <span className="shrink-0 font-medium text-link underline underline-offset-2">Abrir</span>
          </Link>

          <section aria-label="Resumo do ano" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-4">
            <Numero valor={e.leituras} rotulo={e.leituras === 1 ? 'leitura' : 'leituras'} dica={e.releituras > 0 ? `${plural(e.releituras, 'releitura', 'releituras')}` : undefined} />
            <Numero valor={e.volumesDistintos} rotulo={e.volumesDistintos === 1 ? 'volume diferente' : 'volumes diferentes'} />
            <Numero valor={e.mediaDasNotas ? formatarNota(e.mediaDasNotas.media) : '—'} rotulo="média das notas" dica={e.mediaDasNotas ? `de ${plural(e.mediaDasNotas.avaliados, 'volume avaliado', 'volumes avaliados')}` : 'nenhum volume avaliado'} />
            <Numero valor={seq ? seq.meses : 0} rotulo={seq && seq.meses === 1 ? 'mês seguido lendo' : 'meses seguidos lendo'} dica={seq && seq.meses > 1 ? `${nomeDoMesPorNumero(ano, seq.deMes)} a ${nomeDoMesPorNumero(ano, seq.ateMes)}` : undefined} />
          </section>

          <Bloco titulo="Por mês">
            <GraficoPorMes porMes={e.porMes} ano={ano} />
            {e.mesMaisAtivo && (
              <p className="text-sm text-muted-foreground">
                Mês mais ativo: <span className="text-foreground capitalize">{nomeDoMesPorNumero(ano, e.mesMaisAtivo.mes)}</span> ({plural(e.mesMaisAtivo.leituras, 'leitura', 'leituras')}).
              </p>
            )}
          </Bloco>

          <div className="grid gap-5 md:grid-cols-2">
            <Bloco titulo="HQ × mangá">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">HQ</dt>
                  <dd className="font-heading text-2xl font-extrabold">{e.porTipo.hq}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Mangá</dt>
                  <dd className="font-heading text-2xl font-extrabold">{e.porTipo.manga}</dd>
                </div>
              </dl>
            </Bloco>

            <Bloco titulo="Séries">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Iniciadas</dt>
                  <dd className="font-heading text-2xl font-extrabold">{e.seriesIniciadas.length}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Concluídas</dt>
                  <dd className="font-heading text-2xl font-extrabold">{e.seriesConcluidas.length}</dd>
                </div>
              </dl>
              {e.seriesConcluidas.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm">
                  {e.seriesConcluidas.map((s) => (
                    <li key={s.id}>
                      <Link href={`/serie/${s.id}`} className="text-link hover:underline">
                        {s.nome}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">Concluída: todos os volumes que você tem foram lidos e a série não tem volume faltando.</p>
            </Bloco>

            <Bloco titulo="Editoras mais lidas">
              <ListaDeContagem itens={e.editoras} vazio="Nenhuma leitura com tag de editora." />
            </Bloco>

            <Bloco titulo="Tags mais lidas">
              <ListaDeContagem itens={e.tags} vazio="Nenhuma leitura com tags." />
            </Bloco>

            <Bloco titulo="Comprados × lidos">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Comprados</dt>
                  <dd className="font-heading text-2xl font-extrabold">{e.compradosXLidos.comprados}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Lidos pela 1ª vez</dt>
                  <dd className="font-heading text-2xl font-extrabold">{e.compradosXLidos.lidosPelaPrimeiraVez}</dd>
                </div>
              </dl>
              <p className="text-sm text-muted-foreground">
                {e.compradosXLidos.comprados > e.compradosXLidos.lidosPelaPrimeiraVez
                  ? `A fila de leitura cresceu em ${e.compradosXLidos.comprados - e.compradosXLidos.lidosPelaPrimeiraVez}.`
                  : e.compradosXLidos.comprados < e.compradosXLidos.lidosPelaPrimeiraVez
                    ? `A fila de leitura diminuiu em ${e.compradosXLidos.lidosPelaPrimeiraVez - e.compradosXLidos.comprados}.`
                    : 'A fila de leitura ficou do mesmo tamanho.'}{' '}
                Hoje há {plural(e.compradosXLidos.naFilaAgora, 'volume', 'volumes')} na fila.
              </p>
              <p className="text-xs text-muted-foreground">Só contam compras com data de aquisição preenchida.</p>
            </Bloco>

            <Bloco titulo="Empréstimos">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Emprestados</dt>
                  <dd className="font-heading text-2xl font-extrabold">{e.emprestimos.feitos}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Devolvidos</dt>
                  <dd className="font-heading text-2xl font-extrabold">{e.emprestimos.devolvidos}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Volumes que você emprestou e que voltaram no ano. Hoje há {plural(e.emprestimos.abertos, 'empréstimo aberto', 'empréstimos abertos')}.
              </p>
            </Bloco>
          </div>

          {amigos && (
            <Bloco titulo="Você e os amigos">
              <p className="text-sm">
                Nos {plural(amigos.comparados, 'volume lido', 'volumes lidos')} em {ano} que amigos também avaliaram, sua nota ficou acima da média deles em {amigos.acima}, abaixo em{' '}
                {amigos.abaixo}
                {amigos.iguais > 0 ? ` e igual em ${amigos.iguais}` : ''}.
              </p>
              <p className="text-sm text-muted-foreground">
                {amigos.diferencaMedia === 0
                  ? 'Em média, você avalia igual aos amigos.'
                  : `Em média, você avalia ${formatarNota(Math.abs(amigos.diferencaMedia))} ${Math.abs(amigos.diferencaMedia) === 1 ? 'ponto' : 'pontos'} ${amigos.diferencaMedia > 0 ? 'acima' : 'abaixo'} dos amigos.`}
              </p>
              <p className="text-xs text-muted-foreground">Só entram amigos que compartilham as notas com você.</p>
            </Bloco>
          )}
        </>
      )}
    </div>
  )
}
