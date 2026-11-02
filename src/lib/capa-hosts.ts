/**
 * Hosts de onde as capas podem vir (os mesmos dos provedores da cascata). Open Library redireciona
 * para archive.org e seus subdomínios. Fonte única: o download no servidor confere esta lista e a CSP
 * (`img-src`) a usa para o navegador poder mostrar os candidatos antes de a pessoa escolher.
 */
export const HOSTS_CAPA_EXATOS = new Set(['books.google.com', 'covers.openlibrary.org', 'uploads.mangadex.org'])
export const DOMINIOS_CAPA = ['googleusercontent.com', 'anilist.co', 'archive.org']

/** Fontes para `img-src`: hosts exatos e os domínios com qualquer subdomínio. */
export const FONTES_IMG_CAPA = [
  ...Array.from(HOSTS_CAPA_EXATOS, (h) => `https://${h}`),
  ...DOMINIOS_CAPA.map((d) => `https://${d} https://*.${d}`),
]
