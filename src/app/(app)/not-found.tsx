import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NaoEncontrado() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Não encontrado</h1>
      <p className="text-sm text-muted-foreground">
        Este item ou série não existe (ou o link está incorreto).
      </p>
      <Button render={<Link href="/colecao" />}>Ver a coleção</Button>
    </div>
  )
}
