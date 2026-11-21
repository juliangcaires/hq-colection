/**
 * Endpoint de Web Push aceito: só `https://` de um serviço de push de navegador. O servidor faz POST para esse endereço,
 * então um host livre seria um pedido a um destino escolhido pelo usuário. A mesma regra está na função `push_assinar`
 * (migration 0034); mudou aqui, mude lá (e numa migration nova, nunca editando a antiga).
 *
 *  - fcm.googleapis.com ................ Chrome / Android
 *  - *.push.services.mozilla.com ....... Firefox
 *  - *.push.apple.com .................. Safari / iPhone (web.push.apple.com)
 *  - *.notify.windows.com .............. Edge / Windows (WNS)
 *
 * Este arquivo não depende de nada do servidor: o cliente e o servidor podem importá-lo.
 */

const HOST_EXATO = new Set(['fcm.googleapis.com'])
const SUFIXOS = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com']
const MAX_ENDPOINT = 2048

export function endpointDePushPermitido(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > MAX_ENDPOINT) return false
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  if (url.port && url.port !== '443') return false
  const host = url.hostname.toLowerCase()
  if (HOST_EXATO.has(host)) return true
  // O sufixo exige um rótulo antes (`x.push.apple.com`); o domínio puro e hosts "parecidos" (`...apple.com.evil.com`) não passam.
  return SUFIXOS.some((s) => host.length > s.length && host.endsWith(s) && /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host.slice(0, -s.length)))
}
