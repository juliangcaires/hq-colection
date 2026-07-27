'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'

const PREFIXO = 'scroll:'

/**
 * Preserva a posição de rolagem de uma lista ao sair e voltar dela.
 *
 * Não dá para confiar na restauração nativa do Next aqui: toda mutação chama
 * `revalidatePath('/colecao')` (e o ItemForm ainda faz `router.refresh()`), o
 * que invalida a entrada da lista no Router Cache. Com `staleTimes.dynamic = 0`,
 * o `router.back()` refaz o fetch do RSC e o documento ainda tem altura 0 na
 * hora em que o browser tentaria restaurar — daí a lista voltar ao topo.
 *
 * A posição é guardada por ENTRADA DO HISTÓRICO, não por URL: gravamos um id na
 * `history.state` e usamos ele como chave no `sessionStorage`. Assim voltar
 * (back/forward) cai onde estava, enquanto abrir a lista pelo menu — que cria
 * uma entrada nova, sem id — continua começando do topo.
 */

// `useLayoutEffect` avisa no SSR; a restauração só existe no cliente mesmo.
const useEfeitoDeLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect

function idDaEntrada(): string {
  const estado = (window.history.state ?? {}) as Record<string, unknown>
  const existente = estado.__scrollId
  if (typeof existente === 'string') return existente

  const novo = Math.random().toString(36).slice(2)
  // Preserva o que o Next guarda na state (árvore de rotas etc.).
  window.history.replaceState({ ...estado, __scrollId: novo }, '')
  return novo
}

export function ScrollRestore() {
  const chaveRef = useRef<string | null>(null)

  useEfeitoDeLayout(() => {
    const chave = PREFIXO + idDaEntrada()
    chaveRef.current = chave

    const salvo = Number(sessionStorage.getItem(chave))
    if (!Number.isFinite(salvo) || salvo <= 0) return

    window.scrollTo(0, salvo)

    // A lista inteira vem renderizada do servidor e os cards reservam altura com
    // `aspect-[2/3]` antes das capas carregarem, então uma passada costuma bastar.
    // O frame extra cobre o caso de o documento ainda estar curto.
    const frame = requestAnimationFrame(() => {
      if (Math.abs(window.scrollY - salvo) > 1) window.scrollTo(0, salvo)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    let agendado = false

    function salvar() {
      const chave = chaveRef.current
      if (chave) sessionStorage.setItem(chave, String(window.scrollY))
    }

    // Salvar a cada evento de scroll é caro; um por frame basta e mantém o valor
    // sempre atualizado — não dá para salvar só no unmount, porque nessa hora o
    // router já pode ter mexido na rolagem.
    function aoRolar() {
      if (agendado) return
      agendado = true
      requestAnimationFrame(() => {
        agendado = false
        salvar()
      })
    }

    window.addEventListener('scroll', aoRolar, { passive: true })
    window.addEventListener('pagehide', salvar)
    return () => {
      window.removeEventListener('scroll', aoRolar)
      window.removeEventListener('pagehide', salvar)
      salvar()
    }
  }, [])

  return null
}
