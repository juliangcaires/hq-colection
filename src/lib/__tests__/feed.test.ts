import { describe, expect, it } from 'vitest'
import { frasesDoResumo, tempoRelativo, tituloDoPost, urlDeCapaDoFeed } from '@/lib/feed'

describe('tituloDoPost', () => {
  const base = { serieNome: 'Berserk', titulo: 'Berserk 3', numeroVolume: 3, qtd: 1 }
  it('um volume de série vira "Série #n" e lote vira "N volumes de Série"', () => {
    expect(tituloDoPost({ ...base, titulo: 'A Espada' })).toBe('Berserk #3')
    expect(tituloDoPost({ ...base, qtd: 12 })).toBe('12 volumes de Berserk')
  })
  it('sem série usa só o título', () => {
    expect(tituloDoPost({ serieNome: null, titulo: 'Maus', numeroVolume: null, qtd: 1 })).toBe('Maus')
    expect(tituloDoPost({ serieNome: null, titulo: 'Maus', numeroVolume: null, qtd: 2 })).toBe('2 volumes')
  })
  it('não repete o número quando o título já o traz', () => {
    expect(tituloDoPost({ serieNome: 'Berserk', titulo: 'Berserk #3', numeroVolume: 3, qtd: 1 })).toBe('Berserk #3')
  })
})

describe('urlDeCapaDoFeed', () => {
  it('privada vai pela rota do feed; nome inválido ou sem capa vira null', () => {
    const arquivo = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f-1700000000000.jpg'
    expect(urlDeCapaDoFeed({ capa: arquivo, itemId: 'abc' })).toBe('/feed/capa/abc')
    expect(urlDeCapaDoFeed({ capa: '../x.jpg', itemId: 'abc' })).toBeNull()
    expect(urlDeCapaDoFeed({ capa: null, itemId: 'abc' })).toBeNull()
  })
})

describe('tempoRelativo', () => {
  const agora = new Date('2026-11-17T12:00:00Z')
  it('escala de agora a dias e cai na data depois de 30 dias', () => {
    expect(tempoRelativo('2026-11-17T11:59:40Z', agora)).toBe('agora')
    expect(tempoRelativo('2026-11-17T11:55:00Z', agora)).toBe('há 5 min')
    expect(tempoRelativo('2026-11-17T09:00:00Z', agora)).toBe('há 3 h')
    expect(tempoRelativo('2026-11-16T09:00:00Z', agora)).toBe('ontem')
    expect(tempoRelativo('2026-11-13T12:00:00Z', agora)).toBe('há 4 dias')
    expect(tempoRelativo('2026-09-01T12:00:00Z', agora)).toMatch(/2026/)
    expect(tempoRelativo('lixo', agora)).toBe('')
  })
})

describe('frasesDoResumo', () => {
  it('"sua semana: N lidos" e, havendo amigos, quantos leram', () => {
    expect(frasesDoResumo({ meusLidos: 1, amigos: 0, lidosAmigos: 0, destaque: null })).toEqual(['Sua semana: 1 volume lido.'])
    expect(frasesDoResumo({ meusLidos: 4, amigos: 2, lidosAmigos: 7, destaque: null })).toEqual(['Sua semana: 4 volumes lidos.', '2 amigos leram 7 volumes.'])
  })
})
