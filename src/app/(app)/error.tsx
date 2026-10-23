'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function ErroDaPagina({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Algo deu errado</h1>
      <p className="text-sm text-muted-foreground">
        Não consegui carregar esta página. Pode ter sido uma falha passageira — tente de novo.
      </p>
      {digest && <p className="text-xs text-muted-foreground">código: {digest}</p>}
      <div className="flex gap-2">
        <Button onClick={() => retry()}>Tentar de novo</Button>
        <Button variant="outline" render={<Link href="/" />}>
          Ir para o início
        </Button>
      </div>
    </div>
  )
}
