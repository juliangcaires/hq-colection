/**
 * Rotas que não exigem login. O casamento é por SEGMENTO: `/c` libera `/c` e `/c/<token>/…`, nunca `/colecao`.
 * (Com `startsWith('/c')`, a coleção inteira do app viraria pública.)
 */
export const ROTAS_PUBLICAS = ['/login', '/criar-conta', '/c']

export function ehRotaPublica(pathname: string): boolean {
  return ROTAS_PUBLICAS.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`))
}

/** Páginas de compartilhamento: não devem aparecer em buscadores nem em cache compartilhado. */
export function ehRotaDeCompartilhamento(pathname: string): boolean {
  return pathname === '/c' || pathname.startsWith('/c/')
}
