'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Estrelas } from '@/components/ui/estrelas'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { OpcaoRadio } from '@/components/series/opcao-radio'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { avaliarSerie, type ModoAvaliacaoSerie } from '@/app/(app)/itens/actions'
import { desembrulhar } from '@/lib/resultado'
import { formatarNota } from '@/lib/nota'

/**
 * Avaliação da série. Duas formas de ter a nota:
 * - própria: vale para a série toda (opcionalmente replicada em cada volume lido);
 * - média: sem nota própria, vale a média das notas dadas volume a volume.
 */
export function AvaliarSerie({
  serieId,
  notaAtual,
  criticaAtual,
  media,
  avaliados,
  lidos,
}: {
  serieId: string
  /** Nota própria da série; null quando vale a média. */
  notaAtual: number | null
  criticaAtual: string | null
  /** Média das notas dos volumes lidos, ou null se nenhum foi avaliado. */
  media: number | null
  avaliados: number
  lidos: number
}) {
  const router = useRouter()
  const [nota, setNota] = useState<number | null>(notaAtual)
  const [critica, setCritica] = useState(criticaAtual ?? '')
  const [aberto, setAberto] = useState(false)
  const [modo, setModo] = useState<'serie' | 'serie_e_sem_nota' | 'serie_e_todos'>('serie_e_sem_nota')
  const [isPending, startTransition] = useTransition()

  const alterado = nota !== notaAtual || critica.trim() !== (criticaAtual ?? '')

  function enviar(m: ModoAvaliacaoSerie) {
    startTransition(async () => {
      try {
        const r = desembrulhar(
          await avaliarSerie({ serieId, modo: m, nota, critica: critica.trim() }),
        )
        toast.success(
          m === 'media'
            ? 'A série agora vale a média dos volumes'
            : m === 'serie'
              ? 'Avaliação da série salva'
              : `Avaliação da série salva e nota aplicada a ${r.volumes} ${r.volumes === 1 ? 'volume' : 'volumes'}`,
        )
        setAberto(false)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao avaliar a série')
      }
    })
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="mr-auto">
          <p className="text-sm font-medium text-foreground">Nota da série</p>
          <p className="text-xs text-muted-foreground">
            {notaAtual !== null
              ? 'Nota própria da série.'
              : media !== null
                ? `Sem nota própria: vale a média de ${avaliados} ${avaliados === 1 ? 'volume avaliado' : 'volumes avaliados'} (${formatarNota(media)}).`
                : 'Sem nota própria e nenhum volume avaliado ainda.'}
          </p>
        </div>
        <Estrelas valor={nota ?? (notaAtual === null ? media : null)} onChange={setNota} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="critica-serie">Crítica da série</Label>
        <Textarea
          id="critica-serie"
          value={critica}
          onChange={(e) => setCritica(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="O que achou da série como um todo (opcional)"
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {notaAtual !== null && (
          <Button variant="outline" className="h-11" onClick={() => enviar('media')} disabled={isPending}>
            Usar a média dos volumes
          </Button>
        )}
        <Button className="h-11" onClick={() => setAberto(true)} disabled={isPending || !alterado || nota === null}>
          Salvar avaliação
        </Button>
      </div>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Como aplicar esta avaliação?</DialogTitle>
            <DialogDescription>
              Nota {nota === null ? '' : formatarNota(nota)}
              {critica.trim() ? ' e crítica' : ''} da série.
            </DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="Onde aplicar" className="flex flex-col gap-2">
            <OpcaoRadio
              marcada={modo === 'serie'}
              onSelect={() => setModo('serie')}
              titulo="Só a série"
              texto="Fica como a nota geral da série. Os volumes não recebem nota."
            />
            <OpcaoRadio
              marcada={modo === 'serie_e_sem_nota'}
              onSelect={() => setModo('serie_e_sem_nota')}
              disabled={lidos === 0}
              titulo={`Série + volumes lidos sem nota (${lidos - avaliados})`}
              texto={
                lidos === 0
                  ? 'Nenhum volume lido ainda.'
                  : 'Não toca em volume que já tem nota. Recomendado.'
              }
            />
            <OpcaoRadio
              marcada={modo === 'serie_e_todos'}
              onSelect={() => setModo('serie_e_todos')}
              disabled={lidos === 0}
              alerta
              titulo={`Série + todos os volumes lidos (${lidos})`}
              texto={
                lidos === 0
                  ? 'Nenhum volume lido ainda.'
                  : `Substitui a nota${avaliados > 0 ? ` de ${avaliados} ${avaliados === 1 ? 'volume que já tem' : 'volumes que já têm'} nota` : ''}. A crítica de cada volume continua como está.`
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={() => enviar(modo)} disabled={isPending}>
              {isPending ? 'Salvando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
