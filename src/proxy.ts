import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/criar-conta']

/**
 * CSP com nonce por requisição (guia de CSP do Next): scripts só rodam com o nonce, então um HTML
 * injetado não executa. Estilos mantêm `'unsafe-inline'` (Tailwind/base-ui usam `style=`).
 * O app só conversa com o próprio servidor (o navegador nunca chama o Supabase), daí `connect-src 'self'`.
 */
function politicaDeSeguranca(nonce: string): string {
  const dev = process.env.NODE_ENV === 'development'
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = politicaDeSeguranca(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // `getClaims` valida a assinatura do JWT localmente (chave pública em cache, ~1 ms) e só vai à
  // rede para renovar um token expirado; `getUser` custava uma ida ao Auth (~60 ms) a cada
  // navegação. Contrapartida: um logout feito em outro aparelho só é notado quando o token
  // expirar (padrão 1 h) — as Server Actions seguem usando `getUser` e a RLS vale sempre.
  const { data } = await supabase.auth.getClaims()
  const user = data?.claims ?? null

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path))

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  supabaseResponse.headers.set('Content-Security-Policy', csp)
  return supabaseResponse
}

export const config = {
  // manifest.webmanifest (via app/manifest.ts) precisa ficar público: o
  // navegador o busca sem sessão para decidir se oferece "Instalar app".
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
