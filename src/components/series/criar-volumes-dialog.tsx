'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Layers } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  analisarVolumes,
  CriarVolumesFields,
  volumesQueSeraoCriados,
} from '@/components/series/criar-volumes-fields'
import { criarVolumesEmLote } from '@/app/(app)/itens/actions'
import { buscarCapasEmLote } from '@/lib/capa-lote'
import type { EstadoItem } from '@/lib/types'
import { desembrulhar } from '@/lib/resultado'
import { numeroInvalido, parseNumeroPtBr } from '@/lib/numeros'

const ESTADO_ITEMS = [
  { value: 'comprado', label: 'Comprado' },
  { value: 'lido', label: 'Lido' },
  { value: 'desejo', label: 'Desejo' },
]

/**
 * Cria de uma vez os volumes que você comprou de uma série.
 *
 * Não se confunde com "Adicionar volumes", que só AGRUPA itens que já existem
 * na coleção — aqui os registros nascem.
 */
export function CriarVolumesDialog({
  serieId,
  serieNome,
  temNumeracao,
  numerosOcupados,
  faltantes,
}: {
  serieId: string
  serieNome: string
  temNumeracao: boolean
  numerosOcupados: number[]
  faltantes: number[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState<EstadoItem>('comprado')
  const [preco, setPreco] = useState('')
  const [loja, setLoja] = useState('')
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [isPending, startTransition] = useTransition()

  const analise = analisarVolumes({ texto, numerosOcupados, temNumeracao })
  const aCriar = volumesQueSeraoCriados(analise)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setTexto('')
      setEstado('comprado')
      setPreco('')
      setLoja('')
    }
  }

  function handleCriar() {
    if (analise.bloqueado) return
    if (estado !== 'desejo' && numeroInvalido(preco)) {
      toast.error('Preço inválido')
      return
    }
    startTransition(async () => {
      try {
        const resumo = desembrulhar(await criarVolumesEmLote({
          serieId,
          numeros: analise.numeros,
          estado,
          prioridade: 0,
          preco: estado !== 'desejo' ? parseNumeroPtBr(preco) : null,
          loja: estado !== 'desejo' ? loja || null : null,
          data_aquisicao: estado !== 'desejo' ? data || null : null,
          tagIds: [],
        }))

        toast.success(`${resumo.criados.length} volume(s) criados em "${serieNome}"`)
        if (resumo.ignorados.length > 0) {
          toast.warning(
            `Já existiam na série: ${resumo.ignorados.map((n) => `#${n}`).join(', ')}`
          )
        }

        handleOpenChange(false)
        router.refresh()

        if (resumo.criados.length > 0) {
          const aplicadas = await buscarCapasEmLote(resumo.criados)
          if (aplicadas > 0) {
            toast.success(`Capa encontrada para ${aplicadas} de ${resumo.criados.length}`)
            router.refresh()
          }
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao criar volumes')
      }
    })
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Layers className="h-4 w-4" />
        Criar volumes
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Criar volumes de &ldquo;{serieNome}&rdquo;</DialogTitle>
            <DialogDescription>
              Cria um registro por volume, com o título já montado. Para agrupar itens que você
              já tem na coleção, use &ldquo;Adicionar volumes&rdquo;.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <CriarVolumesFields
              id="criar-volumes-serie"
              texto={texto}
              onTextoChange={setTexto}
              analise={analise}
              faltantes={faltantes}
              temNumeracao={temNumeracao}
              disabled={isPending}
            />

            <div className="flex flex-col gap-1.5">
              <Label>Estado</Label>
              <Select
                items={ESTADO_ITEMS}
                value={estado}
                onValueChange={(v) => v && setEstado(v as EstadoItem)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESTADO_ITEMS.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {estado !== 'desejo' && (
              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lote-preco">Preço por volume</Label>
                  <Input
                    id="lote-preco"
                    type="number"
                    step="0.01"
                    value={preco}
                    onChange={(e) => setPreco(e.target.value)}
                    placeholder="0,00"
                    className="w-28"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lote-loja">Loja</Label>
                  <Input
                    id="lote-loja"
                    value={loja}
                    onChange={(e) => setLoja(e.target.value)}
                    className="w-36"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lote-data">Data</Label>
                  <Input
                    id="lote-data"
                    type="date"
                    value={data}
                    onChange={(e) => setData(e.target.value)}
                    className="w-40"
                  />
                </div>
              </div>
            )}

            <Button onClick={handleCriar} disabled={analise.bloqueado || isPending}>
              {isPending ? 'Criando...' : `Adicionar ${aCriar.length} volume(s)`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
