import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/capa-busca', async (orig) => ({ ...(await orig<typeof import('@/lib/capa-busca')>()), baixarImagemSegura: vi.fn() }))

import { ordenarCandidatos, rotuloDeUsos, USOS_PARA_DESTAQUE, type CandidatoCapa } from '@/lib/capa-busca'
import { buscarCapasDaComunidade, candidatosDaComunidade, memoriaGlobalDaSerie, registrarMemoriaGlobal } from '@/lib/capa-catalogo'
import { urlPublicaDeCapa, urlsDeCapas, ehCapaPublica } from '@/lib/supabase/capas'

const H = (c: string) => c.repeat(64)
const ext = (n: string): CandidatoCapa => ({ url: `https://books.google.com/${n}`, label: n, provedor: 'google_books' })
const com = (n: string, usos: number, nivel: 'isbn' | 'chave' | 'nome') => ({
  url: `https://x.supabase.co/storage/v1/object/public/capas-publicas/${n}.jpg`,
  label: n,
  provedor: 'comunidade' as const,
  ref: n,
  usos,
  nivel,
})

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co/'
})

describe('ordenarCandidatos', () => {
  it('destacada (2+ usos na mesma edição) vem primeiro; sem destaque fica depois dos provedores; só o nome por último', () => {
    const r = ordenarCandidatos([com('a', 1, 'chave'), com('b', 3, 'chave'), com('c', 5, 'nome'), com('d', 2, 'isbn')], [ext('e1'), ext('e2')])
    expect(r.map((c) => c.label)).toEqual(['b', 'd', 'e1', 'e2', 'a', 'c'])
    expect(r.find((c) => c.label === 'b')?.destaque).toBe(true)
    expect(r.find((c) => c.label === 'a')?.destaque).toBe(false)
    expect(r.find((c) => c.label === 'c')?.destaque).toBe(false) // nome que bate nunca é destaque, mesmo muito usado
  })
  it('1 uso não destaca e tira repetidos pela URL', () => {
    const r = ordenarCandidatos([com('a', 1, 'isbn')], [ext('a'), { ...ext('x'), url: com('a', 1, 'isbn').url }])
    expect(r).toHaveLength(2)
    expect(new Set(r.map((c) => c.url)).size).toBe(r.length)
    expect(r[0].destaque).toBeFalsy()
  })
  it('sem comunidade a grade é a dos provedores, e o nível não vaza para o cliente', () => {
    const r = ordenarCandidatos([com('a', 2, 'chave')], [ext('e1')])
    expect(r).toHaveLength(2)
    expect(Object.keys(r[0])).not.toContain('nivel')
    expect(ordenarCandidatos([], [ext('e1')])).toEqual([{ url: 'https://books.google.com/e1', label: 'e1', provedor: 'google_books', ref: undefined, usos: undefined, destaque: undefined }])
  })
  it('limita a grade', () => {
    expect(ordenarCandidatos([], Array.from({ length: 30 }, (_, i) => ext(String(i)))).length).toBeLessThanOrEqual(16)
  })
})

describe('urlPublicaDeCapa / urlsDeCapas', () => {
  it('monta a URL do bucket público só para o formato exato pub/<sha256>.<ext>', () => {
    expect(urlPublicaDeCapa(`pub/${H('a')}.jpg`)).toBe(`https://x.supabase.co/storage/v1/object/public/capas-publicas/${H('a')}.jpg`)
    for (const ruim of ['pub/../x.jpg', 'pub/abc.jpg', `pub/${H('a')}.svg`, `pub/${H('a')}.jpg/../../x`, `u/${H('a')}.jpg`, 'pub/']) {
      expect(urlPublicaDeCapa(ruim)).toBe('')
    }
  })
  it('privadas seguem pela rota autenticada; públicas vão direto ao bucket público', () => {
    const privada = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222-1700000000000.jpg'
    const m = urlsDeCapas([privada, `pub/${H('b')}.png`, null])
    expect(m.get(privada)).toBe('/api/capa/22222222-2222-4222-8222-222222222222-1700000000000.jpg')
    expect(m.get(`pub/${H('b')}.png`)).toContain('/storage/v1/object/public/capas-publicas/')
    expect(ehCapaPublica(privada)).toBe(false)
  })
})

describe('candidatosDaComunidade', () => {
  it('converte para a grade com a URL pública, o id em ref e o rótulo por origem', () => {
    const [a, b] = candidatosDaComunidade([
      { id: 'c1', caminho: `${H('a')}.jpg`, origem: 'api', nivel: 'isbn', usos: 3 },
      { id: 'c2', caminho: `${H('b')}.webp`, origem: 'foto', nivel: 'nome', usos: 0 },
    ])
    expect(a).toMatchObject({ provedor: 'comunidade', ref: 'c1', usos: 3, label: 'Capa da comunidade' })
    expect(a.url).toBe(`https://x.supabase.co/storage/v1/object/public/capas-publicas/${H('a')}.jpg`)
    expect(b.label).toBe('Foto de outro colecionador')
  })
})

describe('acesso ao catálogo', () => {
  const fake = (rpc: (n: string, a: unknown) => Promise<{ data: unknown; error: { message: string } | null }>, linha: unknown = null) =>
    ({ rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: linha, error: null }) }) }) }) }) as never

  it('falha da busca na comunidade não derruba: devolve vazio', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await buscarCapasDaComunidade(fake(async () => ({ data: null, error: { message: 'x' } })), { isbn13: null, chave: 'k', serieChave: null })).toEqual([])
    expect(await buscarCapasDaComunidade(fake(async () => ({ data: [], error: null })), null)).toEqual([])
  })
  it('lê a memória global e só registra provedor de verdade (nunca "comunidade")', async () => {
    expect(await memoriaGlobalDaSerie(fake(async () => ({ data: null, error: null }), { termo: 'Berserk', provedor: 'mangadex', ref: 'abc' }), 'berserk|manga')).toEqual({ termo: 'Berserk', provedor: 'mangadex', ref: 'abc' })
    expect(await memoriaGlobalDaSerie(fake(async () => ({ data: null, error: null })), null)).toBeNull()
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    await registrarMemoriaGlobal(fake(rpc), 'berserk|manga', 'Berserk', 'comunidade', null)
    await registrarMemoriaGlobal(fake(rpc), null, 'Berserk', 'mangadex', null)
    expect(rpc).not.toHaveBeenCalled()
    await registrarMemoriaGlobal(fake(rpc), 'berserk|manga', 'Berserk', 'mangadex', 'abc')
    expect(rpc).toHaveBeenCalledWith('series_busca_global_registrar', { p_serie_chave: 'berserk|manga', p_termo: 'Berserk', p_provedor: 'mangadex', p_ref: 'abc' })
  })
})

describe('selo de usos', () => {
  it('singular e plural', () => {
    expect(rotuloDeUsos(1)).toBe('usada por 1 colecionador')
    expect(rotuloDeUsos(3)).toBe('usada por 3 colecionadores')
  })
  it('o destaque começa em 2 pessoas', () => {
    expect(USOS_PARA_DESTAQUE).toBe(2)
  })
})
