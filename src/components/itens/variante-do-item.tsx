'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { definirVariante, type CandidatoVariante } from '@/app/(app)/itens/actions'
import { desembrulhar } from '@/lib/resultado'
import { VariantePicker, rotuloDoCandidato } from '@/components/itens/variante-picker'

type Ligado = Pick<CandidatoVariante, 'id' | 'titulo' | 'numero_volume' | 'serie_nome'>

const AVISO = 'Volume normal e variante compartilham lido, nota, crítica e data de leitura: editar um reflete no outro.'

/** Na página do volume: vincular a um volume normal ("é variante de..."), ver as variantes ou desvincular. */
export function VarianteDoItem({
  itemId,
  principal,
  variantes,
  sugestoes,
}: {
  itemId: string
  /** Quando este item é variante: o volume normal. */
  principal: Ligado | null
  /** Quando este item tem variantes. */
  variantes: Ligado[]
  /** Candidatos prontos (mesmo número na mesma série), sem o próprio item. */
  sugestoes: CandidatoVariante[]
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [escolhido, setEscolhido] = useState<CandidatoVariante | null>(null)
  const [isPending, startTransition] = useTransition()

  function aplicar(principalId: string | null, mensagem: string) {
    startTransition(async () => {
      try {
        desembrulhar(await definirVariante(itemId, principalId))
        toast.success(mensagem)
        setAberto(false)
        setEscolhido(null)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível salvar o vínculo')
      }
    })
  }

  if (principal) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2/60 p-3 text-sm">
        <Layers className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p>
            <span className="font-medium">Variante de </span>
            <Link href={`/item/${principal.id}`} className="text-link hover:underline">
              {rotuloDoCandidato(principal)}
            </Link>
          </p>
          <p className="text-xs text-muted-foreground">{AVISO}</p>
        </div>
        <Button variant="outline" className="h-10" disabled={isPending} onClick={() => aplicar(null, 'Vínculo desfeito')}>
          Desvincular
        </Button>
      </div>
    )
  }

  if (variantes.length > 0) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2/60 p-3 text-sm">
        <Layers className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p>
            <span className="font-medium">{variantes.length === 1 ? 'Variante: ' : 'Variantes: '}</span>
            {variantes.map((v, i) => (
              <span key={v.id}>
                {i > 0 && ', '}
                <Link href={`/item/${v.id}`} className="text-link hover:underline">
                  {rotuloDoCandidato(v)}
                </Link>
              </span>
            ))}
          </p>
          <p className="text-xs text-muted-foreground">{AVISO}</p>
        </div>
      </div>
    )
  }

  if (!aberto) {
    return (
      <div>
        <Button variant="outline" className="h-10 gap-2" onClick={() => setAberto(true)}>
          <Layers className="size-4" aria-hidden />É variante de…
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/60 p-3">
      <p className="text-sm font-medium">É variante de…</p>
      <VariantePicker valor={escolhido} onChange={setEscolhido} excluirId={itemId} sugestoes={sugestoes} disabled={isPending} />
      <p className="text-xs text-muted-foreground">{AVISO} Se o volume normal já foi lido ou avaliado, este assume o mesmo.</p>
      <div className="flex gap-2">
        <Button className="h-10" disabled={!escolhido || isPending} onClick={() => escolhido && aplicar(escolhido.id, 'Vinculado como variante')}>
          Vincular
        </Button>
        <Button
          variant="outline"
          className="h-10"
          disabled={isPending}
          onClick={() => {
            setAberto(false)
            setEscolhido(null)
          }}
        >
          Cancelar
        </Button>
      </div>
    </div>
  )
}
