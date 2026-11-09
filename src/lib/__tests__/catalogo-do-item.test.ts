import { describe, expect, it, vi } from 'vitest'
import { alimentarCatalogoComItem } from '@/lib/isbn-supabase'

type Chamada = { op: string; args: unknown[] }

function supabaseFalso(opts: { rpc?: { data: unknown; error: { message: string } | null }; serie?: unknown; tags?: unknown[] } = {}) {
  const chamadas: Chamada[] = []
  const fake = {
    rpc: vi.fn(async (nome: string, args: unknown) => {
      chamadas.push({ op: `rpc:${nome}`, args: [args] })
      return opts.rpc ?? { data: 'ed-1', error: null }
    }),
    from(tabela: string) {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.in = () => b
      b.not = () => b
      b.maybeSingle = async () => ({ data: opts.serie ?? null, error: null })
      b.update = (v: unknown) => {
        chamadas.push({ op: `update:${tabela}`, args: [v] })
        return b
      }
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: opts.tags ?? [], error: null }).then(res)
      return b
    },
  }
  return { fake: fake as never, chamadas }
}

const dados = { isbn: '978-85-457-0287-0', titulo: 'Hellboy 1', serieId: 's1', numeroVolume: 1, tipo: 'hq' as const, tagIds: ['t1', 't2'] }

describe('alimentarCatalogoComItem', () => {
  it('registra com origem "usuario", só dados bibliográficos, e liga o item à edição', async () => {
    const { fake, chamadas } = supabaseFalso({
      serie: { nome: 'Hellboy', serie_tags: [{ tags: { nome: 'Mythos', tipo: 'editora' } }] },
      tags: [{ nome: 'Mike Mignola', tipo: 'autor' }, { nome: 'Favoritos', tipo: 'outro' }],
    })
    await alimentarCatalogoComItem(fake, 'item-1', dados)
    const rpc = chamadas.find((c) => c.op === 'rpc:edicao_registrar')!.args[0] as { p_dados: Record<string, unknown> }
    expect(rpc.p_dados).toMatchObject({
      isbn13: '9788545702870',
      origem: 'usuario',
      titulo: 'Hellboy 1',
      serie_nome: 'Hellboy',
      numero_volume: 1,
      editora: 'Mythos',
      autores: ['Mike Mignola'],
      chave_normalizada: 'hellboy|1|hq|mythos',
    })
    // nada de preço, loja, datas, nota ou crítica no que vai para o catálogo compartilhado
    expect(Object.keys(rpc.p_dados).sort()).toEqual(
      ['ano', 'autores', 'capa_url_externa', 'chave_normalizada', 'editora', 'isbn13', 'numero_volume', 'origem', 'paginas', 'serie_nome', 'sinopse', 'tipo', 'titulo'].sort()
    )
    expect(chamadas.find((c) => c.op === 'update:itens')!.args[0]).toEqual({ edicao_id: 'ed-1' })
  })

  it('sem ISBN válido não alimenta o catálogo e solta o vínculo antigo', async () => {
    const { fake, chamadas } = supabaseFalso()
    await alimentarCatalogoComItem(fake, 'item-1', { ...dados, isbn: '123' })
    expect(chamadas.some((c) => c.op === 'rpc:edicao_registrar')).toBe(false)
    expect(chamadas.find((c) => c.op === 'update:itens')!.args[0]).toEqual({ edicao_id: null })
  })

  it('erro ao registrar não lança e não liga o item', async () => {
    const { fake, chamadas } = supabaseFalso({ rpc: { data: null, error: { message: 'sem permissão' } } })
    await expect(alimentarCatalogoComItem(fake, 'item-1', dados)).resolves.toBeUndefined()
    expect(chamadas.some((c) => c.op === 'update:itens')).toBe(false)
  })
})
