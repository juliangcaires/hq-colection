import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/capa-busca', () => ({
  baixarEPersistirCapa: vi.fn(async () => 'u/capa.jpg'),
  buscarCapaPorIsbn: vi.fn(async () => null),
}))

import { cadastrarEdicao } from '@/lib/cadastro-isbn'
import { baixarEPersistirCapa } from '@/lib/capa-busca'

const USER = 'u1'
const ISBN = '9788545702870'
const SERIE_EXISTENTE = '11111111-1111-4111-8111-111111111111'
const TAG_EXISTENTE = '22222222-2222-4222-8222-222222222222'
const EDICAO = '33333333-3333-4333-8333-333333333333'

type Chamada = { op: string; args: unknown[] }

/** Supabase falso: guarda o que foi pedido e responde com o roteiro dado. */
function supabaseFalso(opts: { tagsExistentes?: Record<string, string>; falharItem?: boolean; capaExterna?: string | null } = {}) {
  const chamadas: Chamada[] = []
  let proximoId = 0
  const novoId = () => `gerado-${++proximoId}`
  const fake = {
    rpc: vi.fn(async (nome: string, args: unknown) => {
      chamadas.push({ op: `rpc:${nome}`, args: [args] })
      if (nome === 'item_salvar' && opts.falharItem) return { data: null, error: { message: 'tag_nao_encontrada' } }
      return { data: nome === 'serie_salvar' ? 'serie-nova' : 'item-novo', error: null }
    }),
    from(tabela: string) {
      const estado: { filtros: Record<string, unknown>; insercao?: unknown } = { filtros: {} }
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = (c: string, v: unknown) => {
        estado.filtros[c] = v
        return b
      }
      b.maybeSingle = async () => {
        if (tabela === 'tags') {
          const id = opts.tagsExistentes?.[`${estado.filtros.tipo}:${estado.filtros.nome}`]
          return { data: id ? { id } : null, error: null }
        }
        if (tabela === 'edicoes') return { data: { capa_url_externa: opts.capaExterna ?? null }, error: null }
        return { data: null, error: null }
      }
      b.insert = (v: unknown) => {
        estado.insercao = v
        chamadas.push({ op: `insert:${tabela}`, args: [v] })
        return b
      }
      b.single = async () => ({ data: { id: novoId() }, error: null })
      b.update = (v: unknown) => {
        chamadas.push({ op: `update:${tabela}`, args: [v] })
        return b
      }
      b.delete = () => {
        chamadas.push({ op: `delete:${tabela}`, args: [] })
        return b
      }
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res)
      return b
    },
  }
  return { fake: fake as never, chamadas }
}

const base = { isbn13: '978-85-457-0287-0', titulo: 'Hellboy 1', tipo: 'hq' as const, estado: 'comprado' as const, numero_volume: 1 }

describe('cadastrarEdicao', () => {
  it('série nova nasce com a tag de editora; autores e edicao_id vão no item; ISBN é gravado normalizado', async () => {
    const { fake, chamadas } = supabaseFalso({ tagsExistentes: { 'editora:Mythos': TAG_EXISTENTE }, capaExterna: 'https://books.google.com/x.jpg' })
    const r = await cadastrarEdicao(fake, USER, {
      ...base,
      edicaoId: EDICAO,
      serie: { nova: 'Hellboy' },
      editora: { criar: 'Mythos' },
      autores: [{ criar: 'Mike Mignola' }],
    })
    expect(r).toMatchObject({ itemId: 'item-novo', serieId: 'serie-nova', capa: true })

    const serie = chamadas.find((c) => c.op === 'rpc:serie_salvar')!.args[0] as { p_dados: { nome: string; tem_numeracao: boolean }; p_tag_ids: string[] }
    expect(serie.p_dados).toMatchObject({ nome: 'Hellboy', tem_numeracao: true })
    expect(serie.p_tag_ids).toEqual([TAG_EXISTENTE]) // tag já existia: não duplicou

    const item = chamadas.find((c) => c.op === 'rpc:item_salvar')!.args[0] as { p_dados: Record<string, unknown>; p_tag_ids: string[] }
    expect(item.p_dados).toMatchObject({ isbn: ISBN, edicao_id: EDICAO, serie_id: 'serie-nova', estado: 'comprado', numero_volume: 1 })
    expect(item.p_tag_ids).toEqual(['gerado-1']) // só o autor novo; a editora ficou na série
    expect(chamadas.some((c) => c.op === 'insert:tags' && (c.args[0] as { nome: string }).nome === 'Mignola')).toBe(false)
    expect(baixarEPersistirCapa).toHaveBeenCalledWith(expect.anything(), USER, 'item-novo', 'https://books.google.com/x.jpg')
    expect(chamadas.some((c) => c.op === 'update:itens' && (c.args[0] as { capa_origem: string }).capa_origem === 'api')).toBe(true)
  })

  it('série existente: editora vai no item e nenhuma série é criada', async () => {
    const { fake, chamadas } = supabaseFalso()
    await cadastrarEdicao(fake, USER, { ...base, serie: { id: SERIE_EXISTENTE }, editora: { tagId: TAG_EXISTENTE }, autores: [] })
    expect(chamadas.some((c) => c.op === 'rpc:serie_salvar')).toBe(false)
    const item = chamadas.find((c) => c.op === 'rpc:item_salvar')!.args[0] as { p_dados: { serie_id: string }; p_tag_ids: string[] }
    expect(item.p_dados.serie_id).toBe(SERIE_EXISTENTE)
    expect(item.p_tag_ids).toEqual([TAG_EXISTENTE])
  })

  it('sem confirmação não cria nada: sem série, editora ou autores nenhum insert acontece', async () => {
    const { fake, chamadas } = supabaseFalso()
    await cadastrarEdicao(fake, USER, { ...base, serie: null, editora: null, autores: [] })
    expect(chamadas.filter((c) => c.op.startsWith('insert:'))).toEqual([])
    expect(chamadas.some((c) => c.op === 'rpc:serie_salvar')).toBe(false)
  })

  it('se o item falha, a série recém-criada é apagada', async () => {
    const { fake, chamadas } = supabaseFalso({ falharItem: true })
    await expect(cadastrarEdicao(fake, USER, { ...base, serie: { nova: 'Hellboy' }, editora: null, autores: [] })).rejects.toThrow('Tag não encontrada')
    expect(chamadas.some((c) => c.op === 'delete:series')).toBe(true)
  })

  it('ISBN inválido e título vazio são recusados antes de qualquer escrita', async () => {
    const { fake, chamadas } = supabaseFalso()
    await expect(cadastrarEdicao(fake, USER, { ...base, isbn13: '9788545702871' })).rejects.toThrow('ISBN inválido')
    await expect(cadastrarEdicao(fake, USER, { ...base, titulo: '  ' })).rejects.toThrow()
    expect(chamadas).toEqual([])
  })
})
