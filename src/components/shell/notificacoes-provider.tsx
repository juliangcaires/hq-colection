'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { contarNotificacoes } from '@/app/(app)/notificacoes/actions'

type Valor = {
  naoLidas: number
  /** Consulta o servidor de novo (depois de marcar como lida, ao trocar de tela, de tempos em tempos). */
  atualizar: () => void
}

const Contexto = createContext<Valor>({ naoLidas: 0, atualizar: () => {} })

const INTERVALO_MS = 60_000

/**
 * Guarda o contador de não lidas do sininho. O layout entrega o valor inicial (do servidor); depois ele se atualiza
 * ao trocar de tela, ao voltar para a aba e a cada minuto (o layout não é refeito a cada navegação).
 */
export function NotificacoesProvider({ inicial, children }: { inicial: number; children: React.ReactNode }) {
  const [naoLidas, setNaoLidas] = useState(inicial)
  const pathname = usePathname()

  const atualizar = useCallback(() => {
    void contarNotificacoes().then((r) => {
      if (r.ok) setNaoLidas(r.data)
    })
  }, [])

  useEffect(() => {
    atualizar()
  }, [pathname, atualizar])

  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') atualizar()
    }
    const id = window.setInterval(aoVoltar, INTERVALO_MS)
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [atualizar])

  const valor = useMemo(() => ({ naoLidas, atualizar }), [naoLidas, atualizar])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useNotificacoes(): Valor {
  return useContext(Contexto)
}

/** "9+" quando passa de nove: cabe no selo do sino sem estourar. */
export function rotuloDoContador(n: number): string {
  return n > 9 ? '9+' : String(n)
}
