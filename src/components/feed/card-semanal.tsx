import { CalendarDays } from 'lucide-react'
import { Estrelas } from '@/components/ui/estrelas'
import { frasesDoResumo, tituloDoPost, type ResumoSemanal } from '@/lib/feed'

/** "Sua semana": só um card no app, calculado ao abrir (sem e-mail nem notificação). */
export function CardSemanal({ resumo }: { resumo: ResumoSemanal }) {
  const frases = frasesDoResumo(resumo)
  const d = resumo.destaque
  return (
    <section aria-label="Resumo da semana" className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 font-heading text-[17px] font-bold">
        <CalendarDays className="size-[18px] text-primary" aria-hidden /> Sua semana
      </h2>
      <p className="text-sm text-foreground">{frases.join(' ')}</p>
      {d && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          Destaque dos amigos: <span className="font-medium text-foreground">{tituloDoPost({ serieNome: d.serie, titulo: d.titulo, numeroVolume: d.numeroVolume, qtd: 1 })}</span>
          {d.apelido ? ` (@${d.apelido})` : ''}
          <Estrelas valor={d.nota} tamanho={14} />
        </p>
      )}
    </section>
  )
}
