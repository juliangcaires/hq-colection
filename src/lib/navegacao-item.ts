/**
 * Navegação a partir da página do item: de onde o usuário veio (botão Voltar) e os volumes
 * vizinhos da mesma série (setas anterior/próximo).
 */

/** Primeiro segmento aceito como origem → rótulo do botão Voltar. */
const ROTULOS_ORIGEM: Record<string, string> = {
  '': 'Início',
  colecao: 'Coleção',
  desejos: 'Desejos',
  ranking: 'Ranking',
  amigos: 'Amigos',
  serie: 'Série',
  series: 'Séries',
  emprestimos: 'Empréstimos',
}

/**
 * Valida o `?de=` da URL: só caminho interno de uma página conhecida. Qualquer outra coisa
 * (URL externa, `//host`, barra invertida, `javascript:`, rota desconhecida) vira `null`,
 * senão o botão Voltar viraria um redirecionamento aberto.
 */
export function origemValida(valor: string | string[] | undefined | null): string | null {
  if (typeof valor !== 'string') return null
  if (valor.length === 0 || valor.length > 300) return null
  if (!valor.startsWith('/') || valor.startsWith('//')) return null
  if (/[\\\u0000-\u001f\u007f]/.test(valor)) return null
  if (valor.includes('://')) return null

  let url: URL
  try {
    url = new URL(valor, 'http://interno.local')
  } catch {
    return null
  }
  if (url.origin !== 'http://interno.local') return null

  const segmento = url.pathname.split('/')[1] ?? ''
  if (!(segmento in ROTULOS_ORIGEM)) return null
  return url.pathname + url.search
}

export function rotuloDaOrigem(origem: string): string {
  const segmento = origem.split(/[?#]/)[0].split('/')[1] ?? ''
  return ROTULOS_ORIGEM[segmento] ?? 'Voltar'
}

/** `/item/<id>` preservando a origem do Voltar (quando houver). */
export function hrefDoItem(id: string, de?: string | null): string {
  return de ? `/item/${id}?de=${encodeURIComponent(de)}` : `/item/${id}`
}

export type VolumeDaSerie = { id: string; numero_volume: number | null }

/**
 * Volumes vizinhos pelo número: pula números que não existem como item; o que existe
 * (inclusive como desejo) é o vizinho. Sem número atual, não há vizinhos.
 */
export function vizinhosDeVolume(
  volumes: VolumeDaSerie[],
  idAtual: string,
  numeroAtual: number | null
): { anterior: VolumeDaSerie | null; proximo: VolumeDaSerie | null } {
  if (numeroAtual === null) return { anterior: null, proximo: null }
  let anterior: VolumeDaSerie | null = null
  let proximo: VolumeDaSerie | null = null
  for (const v of volumes) {
    if (v.id === idAtual || v.numero_volume === null) continue
    if (v.numero_volume < numeroAtual) {
      if (!anterior || v.numero_volume > anterior.numero_volume!) anterior = v
    } else if (v.numero_volume > numeroAtual) {
      if (!proximo || v.numero_volume < proximo.numero_volume!) proximo = v
    }
  }
  return { anterior, proximo }
}
