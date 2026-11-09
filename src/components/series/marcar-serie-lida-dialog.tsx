'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Estrelas } from '@/components/ui/estrelas'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { OpcaoRadio } from '@/components/series/opcao-radio'
import {
  desfazerMarcacaoSerie,
  marcarSerieComoLida,
  type ModoMarcacaoSerie,
  type ResumoMarcacaoSerie,
} from '@/app/(app)/itens/actions'
import { desembrulhar } from '@/lib/resultado'
import { formatarNota } from '@/lib/nota'

const MAX_FUROS_EXIBIDOS = 12

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** Resumo do que o modal vai fazer — calculado na página da série a partir dos volumes. */
export type ResumoVolumesSerie = {
  /** Comprados: viram lidos. */
  comprados: number
  /** Desejos: ficam de fora. */
  desejos: number
  /** Lidos + comprados que ainda não têm crítica própria (recebem a da série). */
  semCritica: number
  /** Lidos + comprados que já têm crítica (mantêm a própria). */
  comCritica: number
  /** Lidos + comprados que já têm nota. */
  comNota: number
}

/**
 * "Marcar série como lida": mostra o que vai acontecer, pede nota e crítica (opcionais) e onde aplicar.
 * Tudo roda numa função SQL transacional; depois do toast há "Desfazer".
 */
export function MarcarSerieLidaDialog({
  serieId,
  serieNome,
  resumo,
  temNumeracao,
  furos,
}: {
  serieId: string
  serieNome: string
  resumo: ResumoVolumesSerie
  temNumeracao: boolean
  /** Números que faltam na coleção (só faz sentido em série numerada). */
  furos: number[]
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [nota, setNota] = useState<number | null>(null)
  const [critica, setCritica] = useState('')
  const [modo, setModo] = useState<ModoMarcacaoSerie>('serie_e_sem_nota')
  const [isPending, startTransition] = useTransition()

  const textoCritica = critica.trim()
  const furosExibidos = furos.slice(0, MAX_FUROS_EXIBIDOS)

  function desfazer(snapshot: ResumoMarcacaoSerie['snapshot']) {
    startTransition(async () => {
      try {
        desembrulhar(await desfazerMarcacaoSerie(snapshot))
        toast.success('Marcação desfeita')
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível desfazer')
      }
    })
  }

  function enviar(comAvaliacao: boolean) {
    startTransition(async () => {
      try {
        const r = desembrulhar(
          await marcarSerieComoLida({
            serieId,
            modo,
            nota: comAvaliacao ? nota : null,
            critica: comAvaliacao ? textoCritica || null : null,
          }),
        )
        setAberto(false)
        setNota(null)
        setCritica('')
        toast.success(`${plural(r.marcados, 'volume marcado', 'volumes marcados')} como lido${r.marcados === 1 ? '' : 's'}`, {
          duration: 10_000,
          action: { label: 'Desfazer', onClick: () => desfazer(r.snapshot) },
        })
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao marcar a série como lida')
      }
    })
  }

  return (
    <>
      <Button className="h-11 gap-2" onClick={() => setAberto(true)}>
        <CheckCheck className="size-4" />
        Marcar série como lida
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Marcar série como lida</DialogTitle>
            <DialogDescription className="truncate">{serieNome}</DialogDescription>
          </DialogHeader>

          <ul className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2 p-3 text-sm">
            <li className="text-foreground">
              <strong>{plural(resumo.comprados, 'volume vira lido', 'volumes viram lidos')}</strong>
            </li>
            {resumo.desejos > 0 && (
              <li className="text-muted-foreground">
                {plural(resumo.desejos, 'volume fica de fora', 'volumes ficam de fora')} por estar na lista de desejos
              </li>
            )}
            {temNumeracao && furos.length > 0 && (
              <li className="text-warning-text">
                {furos.length === 1 ? 'Falta ' : 'Faltam '}
                {furosExibidos.map((n) => `#${n}`).join(', ')}
                {furos.length > furosExibidos.length ? ` e mais ${furos.length - furosExibidos.length}` : ''} na coleção
              </li>
            )}
          </ul>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Nota da série (opcional)</Label>
              <Estrelas valor={nota} onChange={setNota} tamanho={36} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="critica-marcar-serie">Crítica da série (opcional)</Label>
              <Textarea
                id="critica-marcar-serie"
                rows={3}
                maxLength={2000}
                value={critica}
                onChange={(e) => setCritica(e.target.value)}
                placeholder="O que achou da série como um todo"
                className="rounded-xl bg-surface-2"
              />
            </div>
          </div>

          {nota !== null && (
            <div role="radiogroup" aria-label="Onde aplicar a nota" className="flex flex-col gap-2">
              <p className="text-sm font-medium text-foreground">
                Onde aplicar a nota {formatarNota(nota)}?
              </p>
              <OpcaoRadio
                marcada={modo === 'serie'}
                onSelect={() => setModo('serie')}
                titulo="Só na série"
                texto="Fica como a nota geral da série. Os volumes não recebem nota."
              />
              <OpcaoRadio
                marcada={modo === 'serie_e_sem_nota'}
                onSelect={() => setModo('serie_e_sem_nota')}
                titulo="Série + volumes sem nota (recomendado)"
                texto="Os volumes que já têm nota mantêm a própria."
              />
              <OpcaoRadio
                marcada={modo === 'serie_e_todos'}
                onSelect={() => setModo('serie_e_todos')}
                alerta
                titulo="Série + todos os volumes"
                texto={`Substitui a nota${resumo.comNota > 0 ? ` de ${plural(resumo.comNota, 'volume que já tem', 'volumes que já têm')} nota` : ' dos volumes'}. A crítica de cada volume continua como está.`}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => enviar(false)} disabled={isPending || resumo.comprados === 0}>
              Pular
            </Button>
            <Button onClick={() => enviar(true)} disabled={isPending || (nota === null && !textoCritica)}>
              {isPending ? 'Salvando...' : 'Marcar e salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
