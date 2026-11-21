/* Service worker do app: só recebe Web Push e abre o app no clique. Não faz cache nem intercepta requisições. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let dados = {}
  try {
    dados = event.data ? event.data.json() : {}
  } catch {
    dados = {}
  }
  const titulo = typeof dados.titulo === 'string' && dados.titulo ? dados.titulo : 'Minha Coleção'
  const opcoes = {
    body: typeof dados.corpo === 'string' ? dados.corpo : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // Mesma tag = o aviso novo substitui o antigo do mesmo assunto em vez de empilhar.
    tag: typeof dados.tag === 'string' ? dados.tag : undefined,
    data: { url: typeof dados.url === 'string' ? dados.url : '/' },
  }
  event.waitUntil(self.registration.showNotification(titulo, opcoes))
})

/** Só caminho do próprio app ("/feed"); qualquer outra coisa vira a página inicial. */
function destino(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return '/'
  return url
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const alvo = new URL(destino(event.notification.data && event.notification.data.url), self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (janelas) => {
      for (const janela of janelas) {
        if (new URL(janela.url).origin !== self.location.origin) continue
        try {
          await janela.focus()
          if ('navigate' in janela) await janela.navigate(alvo)
          return
        } catch {
          // Segue para abrir uma janela nova.
        }
      }
      await self.clients.openWindow(alvo)
    })
  )
})
