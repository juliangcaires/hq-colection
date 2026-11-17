import { describe, expect, it } from 'vitest'
import { chaveObra, chaveSerie } from '@/lib/texto'
import { mediaDosAmigos } from '@/lib/notas-amigos'

describe('chaveObra', () => {
  it('mesma história em editoras/títulos diferentes casa; editora não entra', () => {
    const a = chaveObra({ serie: 'Berserk', numero: 3, titulo: 'Berserk Vol. 3', tipo: 'manga' })
    const b = chaveObra({ serie: 'berserk — Edição de Luxo', numero: 3, titulo: 'x', tipo: 'manga' })
    expect(a).toBe('berserk|3|manga')
    expect(b).not.toBe(a) // "luxo" no nome da série separa; edição de luxo precisa ser a mesma série
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
