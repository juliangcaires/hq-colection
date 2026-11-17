import { describe, expect, it } from 'vitest'
import { caminhoDeAvatar, corDoAvatar, iniciaisDoApelido, PALETA_AVATAR, urlDeAvatarValida, urlPublicaDeAvatar } from '@/lib/avatar'
import { politicaDeSeguranca } from '@/lib/csp'

const SB = 'https://abc.supabase.co'
const UID = '11111111-1111-1111-1111-111111111111'
const ARQ = 'a'.repeat(32)

describe('fallback do avatar', () => {
  it('a cor é fixa por apelido, ignora caixa e vem da paleta', () => {
    expect(corDoAvatar('Maria_HQ')).toBe(corDoAvatar('maria_hq'))
    expect(corDoAvatar('maria_hq')).toBe(corDoAvatar('maria_hq'))
    for (const a of ['a', 'julian', 'maria_hq', 'zé', '']) expect(PALETA_AVATAR).toContain(corDoAvatar(a))
  })
  it('apelidos diferentes espalham pela paleta', () => {
    const cores = new Set(Array.from({ length: 60 }, (_, i) => corDoAvatar(`pessoa_${i}`)))
    expect(cores.size).toBeGreaterThanOrEqual(6)
  })
  it('toda cor da paleta tem contraste ≥ 4,5 com texto branco', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    for (const hex of PALETA_AVATAR) expect(1.05 / (lum(hex) + 0.05), hex).toBeGreaterThanOrEqual(4.5)
  })
  it('iniciais: duas letras, sem acento, "?" sem nome', () => {
    expect(iniciaisDoApelido('maria_silva')).toBe('MS')
    expect(iniciaisDoApelido('julian')).toBe('JU')
    expect(iniciaisDoApelido('édu')).toBe('ED')
    expect(iniciaisDoApelido('')).toBe('?')
    expect(iniciaisDoApelido(null)).toBe('?')
    expect(iniciaisDoApelido('__')).toBe('?')
  })
})

describe('URL da foto', () => {
  const ok = `${SB}/storage/v1/object/public/avatares/${UID}/${ARQ}.webp`
  it('aceita só o bucket de avatares no formato do app', () => {
    expect(urlDeAvatarValida(ok, SB)).toBe(ok)
    expect(urlPublicaDeAvatar(`${UID}/${ARQ}.webp`, SB)).toBe(ok)
    expect(caminhoDeAvatar(ok, SB)).toBe(`${UID}/${ARQ}.webp`)
  })
  it('recusa host externo, outro bucket, nome fora do padrão, http e vazio', () => {
    expect(urlDeAvatarValida(`https://evil.example/${UID}/${ARQ}.webp`, SB)).toBeNull()
    expect(urlDeAvatarValida(`${SB}/storage/v1/object/public/capas-publicas/${UID}/${ARQ}.webp`, SB)).toBeNull()
    expect(urlDeAvatarValida(`${SB}/storage/v1/object/public/avatares/${UID}/../x.webp`, SB)).toBeNull()
    expect(urlDeAvatarValida(`${SB}/storage/v1/object/public/avatares/${UID}/${ARQ}.gif`, SB)).toBeNull()
    expect(urlDeAvatarValida(ok.replace('https', 'http'), SB)).toBeNull()
    expect(urlDeAvatarValida(null, SB)).toBeNull()
    expect(urlDeAvatarValida(ok, undefined)).toBeNull()
  })
  it('a CSP libera só o prefixo do bucket de avatares', () => {
    const img = politicaDeSeguranca('N', { dev: false, supabaseUrl: SB }).split('; ').find((d) => d.startsWith('img-src'))!
    expect(img).toContain(`${SB}/storage/v1/object/public/avatares/`)
    expect(img).not.toMatch(/https:\/\/abc\.supabase\.co(\s|$)/)
  })
})
