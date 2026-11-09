import { FONTES_IMG_CAPA } from '@/lib/capa-hosts'

/**
 * Fonte de `img-src` para as capas do catálogo público: só o prefixo do bucket `capas-publicas` no Supabase
 * (uma CSP com caminho termina em "/" e vale como prefixo). O bucket privado `capas` não entra: o navegador
 * só o vê pela rota autenticada `/api/capa/…`, que é do próprio domínio.
 */
export function fonteImgCapasPublicas(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null
  try {
    const u = new URL(supabaseUrl)
    if (u.protocol !== 'https:') return null
    return `${u.origin}/storage/v1/object/public/capas-publicas/`
  } catch {
    return null
  }
}

/**
 * CSP com nonce por requisição (guia de CSP do Next): scripts só rodam com o nonce, então um HTML
 * injetado não executa. Estilos mantêm `'unsafe-inline'` (Tailwind/base-ui usam `style=`).
 * O app só conversa com o próprio servidor (o navegador nunca chama o Supabase), daí `connect-src 'self'`.
 */
export function politicaDeSeguranca(nonce: string, { dev, supabaseUrl }: { dev: boolean; supabaseUrl?: string }): string {
  const capasPublicas = fonteImgCapasPublicas(supabaseUrl)
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // Hosts de capa: a grade de candidatos da busca automática carrega as imagens direto da fonte,
    // e as capas do catálogo compartilhado vêm do bucket público.
    `img-src 'self' blob: data: ${[...FONTES_IMG_CAPA, ...(capasPublicas ? [capasPublicas] : [])].join(' ')}`,
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}
