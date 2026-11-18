import type { EstadoItem } from '@/lib/types'

/**
 * "Tenho X de Y" de uma série (R8 do estudo do Letterboxd).
 *
 * De onde vem o Y — nunca inventado:
 *  - `declarado`: o campo `total_volumes` da série, que a própria pessoa informou;
 *  - `conhecidos`: sem total informado, o MAIOR número de volume inteiro que a série já tem (inclui os que estão
 *    só na lista de desejos: desejar o 5 prova que a série vai pelo menos até o 5). A tela diz "de N conhecidos";
 *  - `null`: nem total nem volume numerado. Não há Y honesto, então só se mostra o X, sem barra.
 *
 * Contagem: cada volume vale UMA vez.
 *  - variante (`variante_de` preenchido) é outra capa de um volume que já está na lista: não conta;
 *  - dois itens com o mesmo número valem um só (cadastro repetido);
 *  - item sem número conta um a um (não há como saber se são o mesmo);
 *  - `desejo` não é "tenho" (continua faltando); "lido" é um subconjunto do "tenho".
 *
 * Mesma regra de `series_com_resumo` (migration 0027). Função pura, sem I/O.
 */

export type VolumeParaProgresso = {
  numero_volume: number | string | null
  estado: EstadoItem
  variante_de?: string | null
}

export type OrigemDoTotal = 'declarado' | 'conhecidos'

export type ProgressoDaSerie = {
  tenho: number
  lidos: number
  /** Y; `null` quando a série não tem total nem volume numerado. */
  total: number | null
  origem: OrigemDoTotal | null
  /** 0 a 1 (tenho/total, travado em 1); `null` sem total. */
  fracaoTenho: number | null
  fracaoLidos: number | null
}

type DadosBrutos = { tenho: number; lidos: number; totalDeclarado: number | null | undefined; maximoConhecido: number | null | undefined }

function inteiroPositivo(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

/** Monta o resultado a partir de contagens já prontas (é o que o banco devolve na lista de séries). */
export function progressoDeContagens({ tenho, lidos, totalDeclarado, maximoConhecido }: DadosBrutos): ProgressoDaSerie {
  let total: number | null = null
  let origem: OrigemDoTotal | null = null
  if (inteiroPositivo(totalDeclarado)) {
    total = totalDeclarado
    origem = 'declarado'
  } else if (inteiroPositivo(maximoConhecido)) {
    // Número fracionário (1.5) ou repetido pode fazer "tenho" passar do maior número: o Y nunca fica abaixo do X.
    total = Math.max(maximoConhecido, tenho)
    origem = 'conhecidos'
  }
  const fracao = (n: number) => (total === null ? null : Math.min(1, n / total))
  return { tenho, lidos, total, origem, fracaoTenho: fracao(tenho), fracaoLidos: fracao(lidos) }
}

export function calcularProgressoDaSerie(volumes: VolumeParaProgresso[], totalDeclarado?: number | null): ProgressoDaSerie {
  const possuidos = new Set<string>()
  const lidos = new Set<string>()
  let semNumeroPossuidos = 0
  let semNumeroLidos = 0
  let maximo: number | null = null

  volumes.forEach((v) => {
    if (v.variante_de) return
    const n = v.numero_volume === null || v.numero_volume === '' ? null : Number(v.numero_volume)
    const numerado = n !== null && Number.isFinite(n) && n > 0
    if (numerado && inteiroPositivo(n)) maximo = Math.max(maximo ?? 0, n)
    if (v.estado === 'desejo') return
    if (numerado) {
      possuidos.add(String(n))
      if (v.estado === 'lido') lidos.add(String(n))
    } else {
      semNumeroPossuidos++
      if (v.estado === 'lido') semNumeroLidos++
    }
  })

  return progressoDeContagens({
    tenho: possuidos.size + semNumeroPossuidos,
    lidos: lidos.size + semNumeroLidos,
    totalDeclarado,
    maximoConhecido: maximo,
  })
}

/** "tenho 5 de 12", "tenho 5 de 12 conhecidos" (Y inferido) ou só "tenho 5" quando não há Y. */
export function textoDoProgresso(p: ProgressoDaSerie): string {
  if (p.total === null) return `tenho ${p.tenho}`
  return `tenho ${p.tenho} de ${p.total}${p.origem === 'conhecidos' ? ' conhecidos' : ''}`
}

/** Explica de onde vem o Y quando ele não é um total informado; vazio nos outros casos. */
export function dicaDoTotal(p: ProgressoDaSerie): string {
  if (p.origem === 'conhecidos') return 'Sem total informado na série: Y é o maior número de volume cadastrado.'
  if (p.origem === null) return 'Sem total informado nem volumes numerados: não dá para calcular um total.'
  return ''
}
