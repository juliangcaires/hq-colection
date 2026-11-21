/**
 * Lado do navegador do Web Push: converter a chave pública, saber se é iPhone/iPad e se o app está instalado.
 * (No iPhone o push só existe com o app instalado na tela inicial, iOS 16.4 ou mais.)
 */

/** A chave VAPID pública vem em base64 "seguro para URL"; o `subscribe` quer bytes. */
export function chaveParaBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const preenchimento = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + preenchimento).replace(/-/g, '+').replace(/_/g, '/')
  const bruto = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(bruto.length))
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i)
  return bytes
}

export function ehAparelhoApple(userAgent: string, maxTouchPoints = 0): boolean {
  // iPadOS 13+ se apresenta como Mac; o toque o entrega.
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
}

export type SituacaoDoPush = 'indisponivel' | 'instalar-no-iphone' | 'sem-suporte' | 'bloqueado' | 'pronto'

/** O que a tela deve mostrar para este aparelho, na ordem em que cada problema aparece. */
export function situacaoDoPush(c: {
  disponivelNoServidor: boolean
  apple: boolean
  instalado: boolean
  temServiceWorker: boolean
  temPushManager: boolean
  permissao: NotificationPermission | 'indisponivel'
}): SituacaoDoPush {
  if (!c.disponivelNoServidor) return 'indisponivel'
  if (c.apple && !c.instalado) return 'instalar-no-iphone'
  if (!c.temServiceWorker || !c.temPushManager || c.permissao === 'indisponivel') return 'sem-suporte'
  if (c.permissao === 'denied') return 'bloqueado'
  return 'pronto'
}
