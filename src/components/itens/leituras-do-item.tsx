'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { adicionarLeitura, editarLeitura, removerLeitura } from '@/app/(app)/itens/leituras-actions'
import { dataBr } from '@/lib/diario'
import type { LeituraDoItem } from '@/lib/leituras'
import { desembrulhar } from '@/lib/resultado'

/**
 * Leituras do volume: a lista de datas, "Reli" (hoje ou outra data), editar e remover. A nota e a crítica continuam
 * únicas, na seção "Minha leitura". Cada ação grava na hora (não espera o "Salvar" do formulário).
 */
export function LeiturasDoItem({ itemId, leituras, hoje }: { itemId: string; leituras: LeituraDoItem[]; hoje: string }) {
  const router = useRouter()
  const [pendente, startTransition] = useTransition()
  const [novaAberta, setNovaAberta] = useState(false)
  const [dataNova, setDataNova] = useState(hoje)
  const [editando, setEditando] = useState<string | null>(null)
  const [dataEdicao, setDataEdicao] = useState('')
  const [remover, setRemover] = useState<LeituraDoItem | null>(null)

  function executar(acao: () => Promise<unknown>, sucesso: string, aoTerminar?: () => void) {
    startTransition(async () => {
      try {
        desembrulhar((await acao()) as never)
        toast.success(sucesso)
        aoTerminar?.()
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível concluir')
      }
    })
  }

  const reli = (data?: string) =>
    executar(() => adicionarLeitura(itemId, data), 'Leitura registrada.', () => {
      setNovaAberta(false)
      setDataNova(hoje)
    })

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-[18px]" aria-labelledby="leituras-titulo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="leituras-titulo" className="font-heading text-[19px] font-bold">
          Leituras
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => reli()} disabled={pendente}>
            <RotateCcw aria-hidden /> Reli hoje
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setNovaAberta((v) => !v)} disabled={pendente} aria-expanded={novaAberta}>
            Outra data
          </Button>
        </div>
      </div>

      {novaAberta && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="Data da leitura"
            className="h-11 w-auto rounded-[10px] bg-surface-2"
            value={dataNova}
            max={hoje}
            onChange={(e) => setDataNova(e.target.value)}
          />
          <Button type="button" size="sm" onClick={() => reli(dataNova)} disabled={pendente || !dataNova}>
            Registrar
          </Button>
        </div>
      )}

      {leituras.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma leitura com data. Use “Reli” para registrar uma.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {leituras.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-2">
              {editando === l.id ? (
                <>
                  <Input
                    type="date"
                    aria-label="Nova data da leitura"
                    className="h-10 w-auto rounded-[10px] bg-surface-2"
                    value={dataEdicao}
                    max={hoje}
                    onChange={(e) => setDataEdicao(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Salvar data"
                    disabled={pendente || !dataEdicao}
                    onClick={() => executar(() => editarLeitura(itemId, l.id, dataEdicao), 'Data atualizada.', () => setEditando(null))}
                  >
                    <Check aria-hidden />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancelar edição" onClick={() => setEditando(null)}>
                    <X aria-hidden />
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-[15px] font-medium tabular-nums">{dataBr(l.lidoEm)}</span>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">{l.releitura ? 'releitura' : 'primeira leitura'}</span>
                  <span className="ml-auto flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Editar a leitura de ${dataBr(l.lidoEm)}`}
                      disabled={pendente}
                      onClick={() => {
                        setEditando(l.id)
                        setDataEdicao(l.lidoEm)
                      }}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remover a leitura de ${dataBr(l.lidoEm)}`}
                      disabled={pendente}
                      onClick={() => setRemover(l)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={remover !== null}
        onOpenChange={(aberto) => !aberto && setRemover(null)}
        title="Remover esta leitura?"
        description={remover ? `A leitura de ${dataBr(remover.lidoEm)} some do histórico. A nota e a crítica continuam.` : undefined}
        confirmLabel="Remover"
        isPending={pendente}
        onConfirm={() => remover && executar(() => removerLeitura(itemId, remover.id), 'Leitura removida.', () => setRemover(null))}
      />
    </section>
  )
}
