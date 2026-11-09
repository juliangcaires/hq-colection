'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { HandHelping } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { devolverEmprestimo, registrarEmprestimo } from '@/app/(app)/emprestimos/actions'
import { textoDoPrazo } from '@/lib/emprestimos'
import { desembrulhar } from '@/lib/resultado'

export type EmprestimoAberto = { id: string; para_quem: string; emprestado_em: string; devolver_ate: string | null }

const dataBr = (d: string) => d.split('-').reverse().join('/')

/** No detalhe do item: mostra para quem está emprestado (com devolução) ou oferece "Emprestar". */
export function EmprestimoDoItem({
  itemId,
  titulo,
  aberto,
  hoje,
}: {
  itemId: string
  titulo: string
  aberto: EmprestimoAberto | null
  /** `AAAA-MM-DD` no fuso do app, calculado no servidor. */
  hoje: string
}) {
  const router = useRouter()
  const [dialogo, setDialogo] = useState(false)
  const [paraQuem, setParaQuem] = useState('')
  const [desde, setDesde] = useState(hoje)
  const [ate, setAte] = useState('')
  const [obs, setObs] = useState('')
  const [isPending, startTransition] = useTransition()

  function emprestar() {
    startTransition(async () => {
      try {
        desembrulhar(await registrarEmprestimo({ itemId, paraQuem, emprestadoEm: desde || null, devolverAte: ate || null, observacao: obs || null }))
        toast.success(`Emprestado para ${paraQuem.trim()}`)
        setDialogo(false)
        setParaQuem('')
        setAte('')
        setObs('')
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível registrar')
      }
    })
  }

  function devolver() {
    if (!aberto) return
    startTransition(async () => {
      try {
        desembrulhar(await devolverEmprestimo(aberto.id, itemId))
        toast.success('Devolução registrada')
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível registrar a devolução')
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {aberto ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/45 bg-warning/10 p-3">
          <HandHelping className="size-5 shrink-0 text-warning-text" aria-hidden />
          <div className="min-w-0 flex-1 text-sm text-warning-text">
            <p className="font-medium">Emprestado para {aberto.para_quem}</p>
            <p className="text-xs">
              desde {dataBr(aberto.emprestado_em)}
              {aberto.devolver_ate ? ` · ${textoDoPrazo({ devolver_ate: aberto.devolver_ate, devolvido_em: null }, hoje)} (${dataBr(aberto.devolver_ate)})` : ''}
            </p>
          </div>
          <Button className="h-10" onClick={devolver} disabled={isPending}>
            Marcar devolução
          </Button>
        </div>
      ) : (
        <Button variant="outline" className="h-10 gap-2" onClick={() => setDialogo(true)}>
          <HandHelping className="size-4" aria-hidden />
          Emprestar este item
        </Button>
      )}

      <Dialog open={dialogo} onOpenChange={setDialogo}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Emprestar</DialogTitle>
            <DialogDescription className="truncate">{titulo}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="emp-para">Para quem</Label>
              <Input id="emp-para" className="h-11" value={paraQuem} onChange={(e) => setParaQuem(e.target.value)} maxLength={120} placeholder="Nome de quem pegou" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-desde">Emprestado em</Label>
                <Input id="emp-desde" type="date" className="h-11" value={desde} max={hoje} onChange={(e) => setDesde(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-ate">Devolver até</Label>
                <Input id="emp-ate" type="date" className="h-11" value={ate} min={desde || undefined} onChange={(e) => setAte(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="emp-obs">Observação (opcional)</Label>
              <Input id="emp-obs" className="h-11" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} />
            </div>
            <p className="text-xs text-muted-foreground">Empréstimos são só seus: não aparecem em links nem para amigos.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogo(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={emprestar} disabled={isPending || !paraQuem.trim()}>
              {isPending ? 'Salvando...' : 'Registrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
