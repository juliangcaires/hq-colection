import { beforeEach, describe, expect, it, vi } from 'vitest'
import { baseDaFonte, carregarItens, carregarResumo, carregarSeries, rotuloDeVolume, urlDeCapaDaVitrine } from '@/lib/vitrine'

const H = 'a'.repeat(64)
const ARQ = '22222222-2222-4222-8222-222222222222-1700000000000.jpg'
const link = { tipo: 'link' as const, token: 't'.repeat(40) }
const amigo = { tipo: 'amigo' as const, apelido: 'maria_hq' }

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
})

const fake = (data: unknown, error: { message: string } | null = null) => {
  const rpc = vi.fn(async () => ({ data, error }))
  return { cliente: { rpc } as never, rpc }
}

describe('urlDeCapaDaVitrine', () => {
  it('catálogo público vai direto ao bucket; privada passa pela rota da fonte', () => {
    expect(urlDeCapaDaVitrine(link, `pub/${H}.jpg`)).toBe(`https://x.supabase.co/storage/v1/object/public/capas-publicas/${H}.jpg`)
    expect(urlDeCapaDaVitrine(link, ARQ)).toBe(`/c/${link.token}/capa/${ARQ}`)
    expect(urlDeCapaDaVitrine(amigo, ARQ)).toBe(`/amigos/maria_hq/capa/${ARQ}`)
  })
  it('capa ausente ou em formato estranho não vira URL', () => {
    expect(urlDeCapaDaVitrine(link, null)).toBeNull()
    expect(urlDeCapaDaVitrine(link, '../segredo.jpg')).toBeNull()
    expect(urlDeCapaDaVitrine(link, 'pub/../x.jpg')).toBeNull()
    expect(urlDeCapaDaVitrine(link, `${'1'.repeat(36)}/${ARQ}`)).toBeNull()
  })
})

describe('chamadas', () => {
  it('link usa link_* com o token; amigo usa amigo_* com o apelido', async () => {
    const a = fake(null)
    expect(await carregarResumo(a.cliente, link)).toBeNull()
    expect(a.rpc).toHaveBeenCalledWith('link_resumo', { p_token: link.token })
    const b = fake([])
    await carregarItens(b.cliente, amigo, 'desejos', { limite: 10, offset: 20 })
    expect(b.rpc).toHaveBeenCalledWith('amigo_itens', { p_apelido: 'maria_hq', p_secao: 'desejos', p_serie: null, p_limite: 10, p_offset: 20 })
    const c = fake([])
    await carregarSeries(c.cliente, link, 'serie-1')
    expect(c.rpc).toHaveBeenCalledWith('link_series', { p_token: link.token, p_serie: 'serie-1' })
  })

  it('converte numeric/bigint e preenche o resumo', async () => {
    const { cliente } = fake([
      { id: 'i1', titulo: 'T', serie_id: null, serie_nome: null, numero_volume: '2.5', tipo: 'hq', estado: 'lido', capa: null, nota: '4.5', critica: null, lido_em: null, isbn13: null, reservado: false, reservado_por_mim: false, total: '7' },
    ])
    const r = await carregarItens(cliente, link, 'colecao')
    expect(r.total).toBe(7)
    expect(r.itens[0]).toMatchObject({ numero_volume: 2.5, nota: 4.5, reservado: false })
    const resumo = await carregarResumo(fake({ nome: 'Ana', apelido: 'ana', escopo: ['colecao'], colecao: 3, lidos: null, desejos: null, series: null }).cliente, link)
    expect(resumo).toEqual({ nome: 'Ana', apelido: 'ana', escopo: ['colecao'], colecao: 3, lidos: null, desejos: null, series: null })
  })

  it('erro do banco vira exceção (a página mostra o erro, não dados vazios)', async () => {
    await expect(carregarItens(fake(null, { message: 'boom' }).cliente, link, 'colecao')).rejects.toThrow('boom')
  })
})

describe('apoio', () => {
  it('base e rótulo de volume', () => {
    expect(baseDaFonte(amigo)).toBe('/amigos/maria_hq')
    expect(rotuloDeVolume(3)).toBe('#3')
    expect(rotuloDeVolume(1.5)).toBe('#1,5')
    expect(rotuloDeVolume(null)).toBe('')
  })
})
