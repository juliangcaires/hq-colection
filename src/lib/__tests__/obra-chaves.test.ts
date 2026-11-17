import { describe, expect, it } from 'vitest'
import { chaveObra, chaveSerie } from '@/lib/texto'
import { sugerirQuaseCasamentos, casouPorDe, mediaDosAmigos, rotuloCasouPor, rotuloObraDeAmigo } from '@/lib/notas-amigos'

describe('chaveObra', () => {
  it('mesma história em editoras/títulos diferentes casa; editora não entra', () => {
    const a = chaveObra({ serie: 'Berserk', numero: 3, titulo: 'Berserk Vol. 3', tipo: 'manga' })
    const b = chaveObra({ serie: 'berserk — Edição de Luxo', numero: 3, titulo: 'x', tipo: 'manga' })
    expect(a).toBe('berserk|3|manga')
    expect(b).toBe(a) // sufixo de edição não separa mais (migration 0022)
    expect(chaveObra({ serie: ' BERSERK ', numero: 3, titulo: 'outro', tipo: 'manga' })).toBe(a)
  })
  it('número, tipo e série diferenciam', () => {
    expect(chaveObra({ serie: 'Berserk', numero: 4, titulo: '', tipo: 'manga' })).not.toBe('berserk|3|manga')
    expect(chaveObra({ serie: 'Berserk', numero: 3, titulo: '', tipo: 'hq' })).not.toBe('berserk|3|manga')
  })
  it('sem número usa o título; avulso usa o título', () => {
    expect(chaveObra({ serie: 'Sandman', numero: null, titulo: 'Edição Especial', tipo: 'hq' })).toBe('sandman|t:especial|hq')
    expect(chaveObra({ serie: null, numero: null, titulo: 'Maus', tipo: 'hq' })).toBe('maus||hq')
  })
  it('chaveSerie', () => expect(chaveSerie('Berserk', 'manga')).toBe('berserk|manga'))
})

describe('mediaDosAmigos', () => {
  it('ignora quem não deu nota e arredonda', () => {
    expect(mediaDosAmigos([{ nota: 4.5 }, { nota: 4 }, { nota: null }])).toEqual({ media: 4.3, qtd: 2 })
    expect(mediaDosAmigos([{ nota: null }])).toBeNull()
    expect(mediaDosAmigos([])).toBeNull()
  })
})

describe('motivo do casamento', () => {
  it('rótulos na tela', () => {
    expect(rotuloCasouPor('isbn')).toBe('mesmo ISBN')
    expect(rotuloCasouPor('nome')).toBe('mesmo nome e volume')
    expect(rotuloCasouPor('manual')).toBe('vínculo manual')
    expect(rotuloCasouPor(null)).toBeNull()
  })
  it('valor desconhecido cai em nome', () => {
    expect(casouPorDe('isbn')).toBe('isbn')
    expect(casouPorDe('manual')).toBe('manual')
    expect(casouPorDe('x')).toBe('nome')
    expect(casouPorDe(null)).toBe('nome')
  })
  it('rótulo da obra do amigo', () => {
    expect(rotuloObraDeAmigo({ obraChave: 'k', apelido: 'beto', nome: null, titulo: 'Absolute Batman 1', numeroVolume: 1, serieNome: 'Absolute Batman' })).toBe('Absolute Batman #1 — Absolute Batman 1 (@beto)')
    expect(rotuloObraDeAmigo({ obraChave: 'k', apelido: null, nome: null, titulo: 'Maus', numeroVolume: null, serieNome: null })).toBe('Maus')
  })
})

describe('sugerirQuaseCasamentos', () => {
  const o = (obraChave: string, apelido = 'beto') => ({ obraChave, apelido, nome: null, titulo: 't', numeroVolume: 1, serieNome: 's' })
  it('mesmo número e tipo com série parecida sugere; o resto não', () => {
    const r = sugerirQuaseCasamentos('batman absolute|1|hq', [
      o('absolute batman|1|hq'),
      o('batman absolute universe|1|hq'),
      o('absolute batman|2|hq'),
      o('absolute batman|1|manga'),
      o('superman|1|hq'),
      o('batman absolute|1|hq'),
      o('absolute batman|1|hq'),
    ])
    expect(r.map((x) => x.obraChave)).toEqual(['absolute batman|1|hq', 'batman absolute universe|1|hq'])
  })
  it('ignora já vinculadas e obra sem número', () => {
    expect(sugerirQuaseCasamentos('batman absolute|1|hq', [o('absolute batman|1|hq')], ['absolute batman|1|hq'])).toEqual([])
    expect(sugerirQuaseCasamentos('sandman|t:especial|hq', [o('sandman|t:especial|hq')])).toEqual([])
  })
})
