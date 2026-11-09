import { describe, expect, it } from 'vitest'
import { emLotes, linhaSalvavel, marcarDuplicatas, montarCadastro, NOVA_SERIE, SEM_SERIE, type LinhaPrateleira } from '@/lib/prateleira'
import type { ConsultaIsbn } from '@/app/(app)/itens/isbn-actions'

const consulta = (extra: Partial<ConsultaIsbn> = {}, edicaoId: string | null = 'ed-1'): ConsultaIsbn => ({
  isbn13: '9788545702870',
  jaNaColecao: [],
  resultado: {
    status: 'ok',
    fonte: 'brasilapi',
    edicaoId,
    edicao: { isbn13: '9788545702870', titulo: 'Hellboy 1', serie_nome: 'Hellboy', numero_volume: 1, tipo: 'manga', editora: 'Mythos', autores: ['Mike Mignola'], ano: null, paginas: null, sinopse: null, capa_url_externa: null, origem: 'brasilapi' },
  },
  sugestoes: {
    series: [],
    serieAutomatica: false,
    serieNovaNome: 'Hellboy',
    editora: { tag: null, nomeParaCriar: 'Mythos' },
    autores: [{ nome: 'Mike Mignola', tag: null }, { nome: 'John Byrne', tag: { id: 'tag-jb', nome: 'John Byrne' } }],
  },
  ...extra,
})

const linha = (extra: Partial<LinhaPrateleira> = {}): LinhaPrateleira => ({
  chave: 'k', isbn13: '9788545702870', status: 'ok', consulta: consulta(), titulo: 'Hellboy 1', serie: NOVA_SERIE, incluir: true, ...extra,
})

describe('marcarDuplicatas', () => {
  it('a primeira ocorrência é normal e as seguintes são "repetido"', () => {
    const d = marcarDuplicatas([linha({ chave: 'a' }), linha({ chave: 'b' }), linha({ chave: 'c', isbn13: '9791032305843', consulta: null, status: 'consultando' })])
    expect(d).toEqual([null, 'repetido', null])
  })
  it('já na coleção do usuário é marcado como "colecao"', () => {
    const c = consulta({ jaNaColecao: [{ id: 'i1', titulo: 'Hellboy 1', estado: 'comprado' }] })
    expect(marcarDuplicatas([linha({ consulta: c })])).toEqual(['colecao'])
  })
  it('linha que falhou ao salvar não conta como ocorrência anterior', () => {
    expect(marcarDuplicatas([linha({ chave: 'a', status: 'falhou' }), linha({ chave: 'b' })])).toEqual([null, null])
  })
})

describe('linhaSalvavel', () => {
  it('só linhas marcadas, não salvas e com dados ou título digitado', () => {
    expect(linhaSalvavel(linha())).toBe(true)
    expect(linhaSalvavel(linha({ incluir: false }))).toBe(false)
    expect(linhaSalvavel(linha({ status: 'salvo' }))).toBe(false)
    expect(linhaSalvavel(linha({ status: 'consultando' }))).toBe(false)
    expect(linhaSalvavel(linha({ status: 'nao_encontrado', consulta: null, titulo: '' }))).toBe(false)
    expect(linhaSalvavel(linha({ status: 'nao_encontrado', consulta: null, titulo: 'Escrito à mão' }))).toBe(true)
  })
})

describe('montarCadastro', () => {
  const op = { estado: 'comprado' as const, criarTags: false, seriesCriadas: new Map<string, string>() }

  it('série nova e tags novas só quando confirmadas; tag existente sempre entra', () => {
    const c = montarCadastro(linha(), op)
    expect(c).toMatchObject({ estado: 'comprado', tipo: 'manga', numero_volume: 1, edicaoId: 'ed-1', serie: { nova: 'Hellboy' }, editora: null })
    expect(c.autores).toEqual([{ tagId: 'tag-jb' }])
    const comTags = montarCadastro(linha(), { ...op, criarTags: true })
    expect(comTags.editora).toEqual({ criar: 'Mythos' })
    expect(comTags.autores).toEqual([{ criar: 'Mike Mignola' }, { tagId: 'tag-jb' }])
  })

  it('série nova já criada neste lote é reaproveitada pelo nome normalizado', () => {
    const c = montarCadastro(linha(), { ...op, seriesCriadas: new Map([['hellboy', 'serie-9']]) })
    expect(c.serie).toEqual({ id: 'serie-9' })
  })

  it('série existente e avulso', () => {
    expect(montarCadastro(linha({ serie: 'serie-1' }), op).serie).toEqual({ id: 'serie-1' })
    expect(montarCadastro(linha({ serie: SEM_SERIE }), op).serie).toBeNull()
  })

  it('ISBN sem dados da API: cadastro só com o título digitado e sem edição', () => {
    const c = montarCadastro(linha({ status: 'nao_encontrado', consulta: null, titulo: ' Meu gibi ', serie: SEM_SERIE }), op)
    expect(c).toMatchObject({ titulo: 'Meu gibi', edicaoId: null, tipo: 'hq', numero_volume: null, serie: null, editora: null, autores: [] })
  })
})

describe('emLotes', () => {
  it('divide sem perder itens', () => {
    expect(emLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(emLotes([], 3)).toEqual([])
  })
})
