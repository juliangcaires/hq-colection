import { describe, expect, it } from 'vitest'
import { fonteImgCapasPublicas, politicaDeSeguranca } from '@/lib/csp'

describe('CSP', () => {
  it('libera só o prefixo do bucket público de capas, não o Supabase inteiro', () => {
    expect(fonteImgCapasPublicas('https://abc.supabase.co/')).toBe('https://abc.supabase.co/storage/v1/object/public/capas-publicas/')
    const csp = politicaDeSeguranca('N', { dev: false, supabaseUrl: 'https://abc.supabase.co' })
    const img = csp.split('; ').find((d) => d.startsWith('img-src'))!
    expect(img).toContain('https://abc.supabase.co/storage/v1/object/public/capas-publicas/')
    expect(img).not.toMatch(/https:\/\/abc\.supabase\.co(\s|$)/)
    expect(img).not.toContain('/object/capas')
  })
  it('sem URL válida (ou http) nada é liberado', () => {
    expect(fonteImgCapasPublicas(undefined)).toBeNull()
    expect(fonteImgCapasPublicas('http://abc.supabase.co')).toBeNull()
    expect(fonteImgCapasPublicas('isto não é url')).toBeNull()
    expect(politicaDeSeguranca('N', { dev: false })).not.toContain('supabase')
  })
  it('mantém as defesas de sempre', () => {
    const csp = politicaDeSeguranca('N', { dev: false, supabaseUrl: 'https://abc.supabase.co' })
    expect(csp).toContain("script-src 'self' 'nonce-N' 'strict-dynamic'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain('unsafe-eval')
  })
})
