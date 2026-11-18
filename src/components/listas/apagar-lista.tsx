'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { apagarLista } from '@/app/(app)/listas/actions'
import { desembrulhar } from '@/lib/resultado'

export function ApagarLista({ listaId, titulo }: { listaId: string; titulo: string }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [pendente, startTransition] = useTransition()

  function apagar() {
    startTransition(async () => {
      try {
        desembrulhar(await apagarLista(listaId))
        toast.success('Lista apagada')
        router.push('/listas')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Não foi possível apagar a lista')
      }
    })
  }

  return (
    <>
      <Button type="button" variant="destructive" size="lg" onClick={() => setAberto(true)}>
        <Trash2 aria-hidden /> Apagar lista
      </Button>
      <ConfirmDialog
        open={aberto}
        onOpenChange={setAberto}
        title="Apagar esta lista?"
        description={`"${titulo}" some para você e para os seus amigos, junto com as curtidas e os comentários. Os itens da sua coleção não são afetados.`}
        confirmLabel="Apagar"
        onConfirm={apagar}
        isPending={pendente}
      />
    </>
  )
}
