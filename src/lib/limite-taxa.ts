/**
 * Limite de requisições por chave (token do link) em janela deslizante, na memória do processo.
 *
 * É uma proteção de melhor esforço: em hospedagem sem servidor cada instância tem a sua contagem, então o
 * teto real é "por instância". Serve para frear varredura e abuso óbvios sem custo de banco; o que protege
 * os dados de verdade é o token ter 244 bits e a visibilidade ser decidida no banco.
 */
export type Limitador = {
  /** Registra uma requisição para a chave e diz se ela passa. */
  tentar(chave: string): { ok: boolean; restante: number; reiniciaEmMs: number }
}

export function criarLimitador({
  max,
  janelaMs,
  agora = Date.now,
  maxChaves = 5000,
}: {
  max: number
  janelaMs: number
  agora?: () => number
  maxChaves?: number
}): Limitador {
  const porChave = new Map<string, number[]>()

  function limpar(t: number) {
    for (const [chave, marcas] of porChave) {
      if (marcas.length === 0 || marcas[marcas.length - 1] <= t - janelaMs) porChave.delete(chave)
    }
    // Ainda cheio (muitas chaves ativas): descarta as mais antigas para a memória não crescer sem limite.
    for (const chave of porChave.keys()) {
      if (porChave.size <= maxChaves) break
      porChave.delete(chave)
    }
  }

  return {
    tentar(chave) {
      const t = agora()
      if (porChave.size >= maxChaves) limpar(t)
      const recentes = (porChave.get(chave) ?? []).filter((m) => m > t - janelaMs)
      if (recentes.length >= max) {
        porChave.set(chave, recentes)
        return { ok: false, restante: 0, reiniciaEmMs: recentes[0] + janelaMs - t }
      }
      recentes.push(t)
      porChave.set(chave, recentes)
      return { ok: true, restante: max - recentes.length, reiniciaEmMs: janelaMs }
    },
  }
}

/** Páginas: uma "visita" já faz poucas chamadas. Capas: uma grade pede dezenas de imagens de uma vez. */
export const limitePaginas = criarLimitador({ max: 90, janelaMs: 60_000 })
export const limiteCapas = criarLimitador({ max: 900, janelaMs: 60_000 })
