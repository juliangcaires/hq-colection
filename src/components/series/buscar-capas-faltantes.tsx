'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ImageDown, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { buscarCapasFaltantes, type ItemParaCapa } from '@/lib/capa-lote'

/**
 * Completa as capas dos volumes sem capa usando só ISBN e a memória da série
 * (nunca busca por título). Aplica direto e não troca capa existente.
 */
export function BuscarCapasFaltantes({ itens }: { itens: ItemParaCapa[] }) {
  const router = useRouter()
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null)
  const rodando = progresso !== null

  async function executar() {
    setProgresso({ feitos: 0, total: itens.length })
    try {
      const aplicadas = await buscarCapasFaltantes(itens, (feitos, total) => setProgresso({ feitos, total }))
      const naoEncontradas = itens.length - aplicadas
      const resumo = `${aplicadas} aplicada(s), ${naoEncontradas} não encontrada(s)`
      if (aplicadas > 0) toast.success(`Capas faltantes: ${resumo}`)
      else toast.info(`Capas faltantes: ${resumo}`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao buscar capas')
    } finally {
      setProgresso(null)
    }
  }

  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={executar}
      disabled={rodando || itens.length === 0}
      title={itens.length === 0 ? 'Todos os volumes já têm capa' : 'Usa só ISBN e a memória da série'}
    >
      {rodando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />}
      {rodando ? `Buscando ${progresso.feitos}/${progresso.total}` : 'Buscar capas faltantes'}
    </Button>
  )
}
