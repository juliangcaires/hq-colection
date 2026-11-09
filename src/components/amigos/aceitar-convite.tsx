'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { aceitarConvite } from '@/app/(app)/amigos/actions'
import { desembrulhar } from '@/lib/resultado'

export function AceitarConvite({ codigo, nome }: { codigo: string; nome: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-[18px]">
      <p className="text-sm">
        <strong>{nome}</strong> te convidou para ser amigo. Ao aceitar, vocês veem as coleções um do outro, só nas seções que cada um liberou.
        Preço, loja e data de compra nunca aparecem.
      </p>
      <Button
        className="h-12"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            try {
              const apelido = desembrulhar(await aceitarConvite(codigo))
              toast.success('Agora vocês são amigos')
              router.push(`/amigos/${apelido}`)
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Não foi possível aceitar')
            }
          })
        }
      >
        {isPending ? 'Aceitando...' : 'Aceitar convite'}
      </Button>
    </div>
  )
}
