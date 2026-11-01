/**
 * A página de uma série não tem guia própria: a rota é `/serie/[id]`, no
 * singular, e sem esse apelido a navegação apagaria inteira ao abrir uma série.
 *
 * `/item/[id]` ficou de fora de propósito — um item se abre tanto da Coleção
 * quanto dos Desejos, então acender uma das duas erraria metade das vezes.
 */
const APELIDOS: Record<string, string> = {
  '/serie': '/series',
}

export function estaAtivo(href: string, pathname: string): boolean {
  const primeiroSegmento = `/${pathname.split('/')[1] ?? ''}`
  const rota = APELIDOS[primeiroSegmento] ?? pathname

  // Início casaria com tudo por prefixo; só a rota exata acende.
  if (href === '/') return rota === '/'
  return rota === href || rota.startsWith(`${href}/`)
}

export function iniciais(email?: string): string {
  const base = (email ?? '').split('@')[0].replace(/[^a-zA-Z0-9]+/g, ' ').trim()
  if (!base) return '?'
  const partes = base.split(' ')
  const letras = partes.length > 1 ? partes[0][0] + partes[1][0] : base.slice(0, 2)
  return letras.toUpperCase()
}
