import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { politicaDeSeguranca } from '@/lib/csp'
import { ehRotaDeCompartilhamento, ehRotaPublica } from '@/lib/rotas'
import { OPCOES_COOKIE } from '@/lib/supabase/cookies'

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = politicaDeSeguranca(nonce, { dev: process.env.NODE_ENV === 'development', supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL })
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
            supabaseResponse.cookies.set(name, value, { ...options, ...OPCOES_COOKIE })
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

  const isPublicPath = ehRotaPublica(request.nextUrl.pathname)

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  supabaseResponse.headers.set('Content-Security-Policy', csp)
  // Coleção compartilhada: fora dos buscadores, sem cache compartilhado (o link pode ser revogado a qualquer momento).
  if (ehRotaDeCompartilhamento(request.nextUrl.pathname)) {
    supabaseResponse.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
    supabaseResponse.headers.set('Cache-Control', 'private, no-store')
  }
  return supabaseResponse
}

export const config = {
  // manifest.webmanifest (via app/manifest.ts) precisa ficar público: o
  // navegador o busca sem sessão para decidir se oferece "Instalar app".
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
