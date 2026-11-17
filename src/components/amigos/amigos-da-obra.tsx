import { Avatar } from '@/components/ui/avatar'
import { Estrelas } from '@/components/ui/estrelas'
import { CriticaSpoiler } from '@/components/ui/critica-spoiler'
import { InteracaoDoItem } from '@/components/feed/interacao-do-item'
import { formatarNota } from '@/lib/nota'
import { mediaDosAmigos, rotuloCasouPor, type AvaliacaoDeAmigo } from '@/lib/notas-amigos'

/**
 * Bloco "Amigos" da página do item e da série: média das notas dos amigos e a nota/crítica de cada um.
 * Sem nenhum amigo com nota ou crítica visível, não aparece. Texto sempre como texto puro.
 */
export function AmigosDaObra({ avaliacoes, rotulo }: { avaliacoes: AvaliacaoDeAmigo[]; rotulo: 'volume' | 'série' }) {
  if (avaliacoes.length === 0) return null
  const m = mediaDosAmigos(avaliacoes)
  return (
    <section aria-label="Amigos" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-heading text-base font-bold text-foreground">Amigos</h2>
        {m && (
          <p className="text-sm text-muted-foreground">
            Média <span className="font-semibold text-foreground">{formatarNota(m.media)}</span> · {m.qtd} {m.qtd === 1 ? 'amigo avaliou' : 'amigos avaliaram'}
          </p>
        )}
      </header>
      <ul className="flex flex-col gap-4">
        {avaliacoes.map((a) => (
          <li key={a.itemId ?? a.apelido} className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <Avatar apelido={a.apelido} nome={a.nome} url={a.avatarUrl} size={32} />
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate text-sm font-semibold text-foreground">{a.nome || a.apelido || 'Alguém'}</p>
                <p className="text-xs text-muted-foreground">
                  {a.apelido ? `@${a.apelido}` : ''}
                  {a.lidoEm ? `${a.apelido ? ' · ' : ''}leu em ${new Date(`${a.lidoEm}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}
                  {a.casouPor && rotulo === 'volume' ? `${a.apelido || a.lidoEm ? ' · ' : ''}${rotuloCasouPor(a.casouPor)}` : ''}
                </p>
              </div>
              {a.nota !== null && (
                <div className="flex items-center gap-2">
                  <Estrelas valor={a.nota} tamanho={14} mostrarValor={false} />
                  <span className="text-sm font-medium text-foreground">{formatarNota(a.nota)}</span>
                </div>
              )}
            </div>
            {a.critica && <CriticaSpoiler texto={a.critica} spoiler={a.criticaSpoiler} />}
            {a.itemId && a.interagivel && (
              <InteracaoDoItem itemId={a.itemId} curti={a.curti} curtidas={a.curtidas} comentarios={a.comentarios} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
