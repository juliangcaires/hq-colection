import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ITENS_POR_PAGINA } from '@/lib/filtros-url'

/** Link para a mesma lista com mais uma página; `scroll={false}` mantém o ponto onde a pessoa está. */
export function CarregarMais({
  params,
  limite,
  mostrando,
  total,
  passo = ITENS_POR_PAGINA,
}: {
  params: Record<string, string | undefined>
  limite: number
  mostrando: number
  total: number
  /** Quantos itens a mais cada clique traz (padrão: uma página da Coleção). */
  passo?: number
}) {
  if (mostrando >= total) return null

  const proximo = new URLSearchParams()
  for (const [chave, valor] of Object.entries(params)) {
    if (valor && chave !== 'limite') proximo.set(chave, valor)
  }
  proximo.set('limite', String(limite + passo))

  return (
    <div className="flex flex-col items-center gap-2 pt-2">
      <p className="text-xs text-muted-foreground">
        Mostrando {mostrando} de {total}
      </p>
      <Button variant="outline" render={<Link href={`?${proximo.toString()}`} scroll={false} />}>
        Carregar mais
      </Button>
    </div>
  )
}
