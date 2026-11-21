import { describe, expect, it } from 'vitest'
import { resumoDaSerie } from '@/lib/serie-resumo'
import type { TagLite } from '@/lib/types'

const tags: TagLite[] = [
  { id: 'e1', nome: 'Panini', tipo: 'editora', cor: null },
  { id: 'p1', nome: 'Batman', tipo: 'personagem', cor: null },
  { id: 'p2', nome: 'Coringa', tipo: 'personagem', cor: null },
  { id: 'a1', nome: 'Snyder', tipo: 'autor', cor: null },
  { id: 'x', nome: 'Fora', tipo: 'arco', cor: null },
]
const base = { tipo: 'hq' as const, total_volumes: 5, em_publicacao: false, tem_numeracao: true, observacoes: 'Edição de bolso', tagIds: ['e1', 'p1', 'p2', 'a1'] }

describe('resumoDaSerie (página da série em modo leitura)', () => {
  it('mostra o que está preenchido, com as tags agrupadas por tipo na ordem do formulário', () => {
    const r = resumoDaSerie(base, tags)
    expect(r.campos).toEqual([
      { rotulo: 'Tipo', valor: 'HQ' },
      { rotulo: 'Volumes', valor: '5' },
      { rotulo: 'Publicação', valor: 'Encerrada' },
      { rotulo: 'Numeração', valor: 'Numerada' },
    ])
    expect(r.tags).toEqual([
      { tipo: 'editora', rotulo: 'Editora', nomes: ['Panini'] },
      { tipo: 'personagem', rotulo: 'Personagem', nomes: ['Batman', 'Coringa'] },
      { tipo: 'autor', rotulo: 'Autor', nomes: ['Snyder'] },
    ])
    expect(r.observacoes).toBe('Edição de bolso')
  })

  it('campo sem valor não aparece: sem total, sem numeração, sem tag, observações vazias ou só espaços', () => {
    const r = resumoDaSerie({ ...base, tipo: 'manga', total_volumes: null, em_publicacao: true, tem_numeracao: false, observacoes: '  \n ', tagIds: [] }, tags)
    expect(r.campos).toEqual([
      { rotulo: 'Tipo', valor: 'Mangá' },
      { rotulo: 'Publicação', valor: 'Em publicação' },
    ])
    expect(r.tags).toEqual([])
    expect(r.observacoes).toBeNull()
    expect(resumoDaSerie({ ...base, observacoes: null }, tags).observacoes).toBeNull()
  })

  it('tag que não existe mais na lista é ignorada, e total 0 não some por engano', () => {
    const r = resumoDaSerie({ ...base, total_volumes: 0, tagIds: ['fantasma'] }, tags)
    expect(r.tags).toEqual([])
    expect(r.campos).toContainEqual({ rotulo: 'Volumes', valor: '0' })
  })
})
