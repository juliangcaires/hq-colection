import { describe, expect, it } from 'vitest'
import {
  listaInputSchema,
  moverItem,
  notaDoItemSchema,
  resumoDaSituacao,
  rotuloDeItens,
  situacaoDoItem,
  tituloDoItemDaLista,
  urlDeCapaDaLista,
  carregarItensDaLista,
  carregarListas,
} from '@/lib/listas'
import { ErroDeNegocio } from '@/lib/resultado'
import { lancarErroRpc } from '@/lib/rpc'

const HASH = 'c'.repeat(64)
const ITEM = '11111111-1111-4111-8111-111111111111'

describe('listaInputSchema', () => {
  it('aceita título, descrição, ordenada e tipo; apara espaços', () => {
    const r = listaInputSchema.parse({ titulo: '  Ordem de leitura  ', descricao: ' Do começo ', ordenada: true, tipo: 'ordem_leitura' })
    expect(r).toEqual({ titulo: 'Ordem de leitura', descricao: 'Do começo', ordenada: true, tipo: 'ordem_leitura' })
  })
  it('descrição e tipo são opcionais', () => {
    expect(listaInputSchema.safeParse({ titulo: 'A', ordenada: false }).success).toBe(true)
    expect(listaInputSchema.safeParse({ titulo: 'A', descricao: null, ordenada: false, tipo: null }).success).toBe(true)
  })
  it('recusa título vazio ou longo, descrição longa e tipo desconhecido', () => {
    expect(listaInputSchema.safeParse({ titulo: '   ', ordenada: false }).success).toBe(false)
    expect(listaInputSchema.safeParse({ titulo: 'x'.repeat(81), ordenada: false }).success).toBe(false)
    expect(listaInputSchema.safeParse({ titulo: 'A', descricao: 'x'.repeat(501), ordenada: false }).success).toBe(false)
    expect(listaInputSchema.safeParse({ titulo: 'A', ordenada: false, tipo: 'publica' }).success).toBe(false)
    expect(listaInputSchema.safeParse({ titulo: 'A' }).success).toBe(false)
  })
})

describe('notaDoItemSchema', () => {
  it('aceita até 300 caracteres e recusa mais', () => {
    expect(notaDoItemSchema.safeParse('x'.repeat(300)).success).toBe(true)
    expect(notaDoItemSchema.safeParse('x'.repeat(301)).success).toBe(false)
    expect(notaDoItemSchema.safeParse(null).success).toBe(true)
  })
})

describe('moverItem', () => {
  const base = ['a', 'b', 'c', 'd']
  it('sobe e desce um item sem alterar a lista original', () => {
    expect(moverItem(base, 2, 0)).toEqual(['c', 'a', 'b', 'd'])
    expect(moverItem(base, 0, 1)).toEqual(['b', 'a', 'c', 'd'])
    expect(moverItem(base, 1, 3)).toEqual(['a', 'c', 'd', 'b'])
    expect(base).toEqual(['a', 'b', 'c', 'd'])
  })
  it('fora do intervalo ou sem mudança devolve a mesma ordem', () => {
    expect(moverItem(base, 0, -1)).toEqual(base)
    expect(moverItem(base, 3, 4)).toEqual(base)
    expect(moverItem(base, 2, 2)).toEqual(base)
    expect(moverItem([], 0, 1)).toEqual([])
  })
})

describe('urlDeCapaDaLista', () => {
  it('sem capa ou sem item: nada', () => {
    expect(urlDeCapaDaLista(null, ITEM)).toBeNull()
    expect(urlDeCapaDaLista(`${'a'.repeat(8)}.jpg`, null)).toBeNull()
  })
  it('capa privada passa pela rota autorizada da lista (nunca pelo caminho do dono)', () => {
    expect(urlDeCapaDaLista('0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f-1730000000000.jpg', ITEM)).toBe(`/listas/capa/${ITEM}`)
  })
  it('recusa nome de arquivo fora do padrão (caminho com pasta, extensão estranha)', () => {
    expect(urlDeCapaDaLista('../outro/arquivo.jpg', ITEM)).toBeNull()
    expect(urlDeCapaDaLista('abc.exe', ITEM)).toBeNull()
  })
  it('capa do catálogo público vai direto ao bucket público (hash válido) e nunca por pasta de usuário', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://exemplo.supabase.co'
    expect(urlDeCapaDaLista(`pub/${HASH}.jpg`, ITEM)).toBe(`https://exemplo.supabase.co/storage/v1/object/public/capas-publicas/${HASH}.jpg`)
    expect(urlDeCapaDaLista('pub/nao-e-hash.jpg', ITEM)).toBeNull()
  })
})

describe('apresentação do item', () => {
  it('título com série e número, sem repetir o número que o título já tem', () => {
    expect(tituloDoItemDaLista({ serieNome: 'Berserk', titulo: 'Berserk', numeroVolume: 3 })).toBe('Berserk #3')
    expect(tituloDoItemDaLista({ serieNome: 'Berserk', titulo: 'Berserk #3', numeroVolume: 3 })).toBe('Berserk #3')
    expect(tituloDoItemDaLista({ serieNome: null, titulo: 'Maus', numeroVolume: null })).toBe('Maus')
    expect(tituloDoItemDaLista({ serieNome: 'X', titulo: 'Ano Um', numeroVolume: 1.5 })).toBe('X #1,5')
  })
  it('rótulo de quantidade', () => {
    expect([rotuloDeItens(0), rotuloDeItens(1), rotuloDeItens(12)]).toEqual(['vazia', '1 item', '12 itens'])
  })
  it('situação: lido vale mais que tenho', () => {
    expect(situacaoDoItem({ tenho: true, li: true })).toBe('lido')
    expect(situacaoDoItem({ tenho: true, li: false })).toBe('tenho')
    expect(situacaoDoItem({ tenho: false, li: false })).toBe('nao_tenho')
  })
  it('resumo da situação conta tenho e li', () => {
    expect(resumoDaSituacao([{ tenho: true, li: true }, { tenho: true, li: false }, { tenho: false, li: false }])).toEqual({ total: 3, tenho: 2, li: 1 })
    expect(resumoDaSituacao([])).toEqual({ total: 0, tenho: 0, li: 0 })
  })
})

describe('leitura das funções do banco', () => {
  const cliente = (data: unknown, error: { message: string } | null = null) => ({ rpc: async () => ({ data, error }) }) as never

  it('mapeia o resumo de listas e ignora tipo desconhecido', async () => {
    const [l] = await carregarListas(
      cliente([
        { id: 'l1', dono_id: 'u1', apelido: 'ana', nome_exibicao: null, avatar_url: null, proprio: false, titulo: 'T', descricao: null, ordenada: true, tipo: 'invalido', qtd: 2, capa: 'a.jpg', capa_item: 'i1', curtidas: 3, curti: true, comentarios: 1, atualizada_em: '2026-11-17T10:00:00Z' },
      ])
    )
    expect(l).toMatchObject({ id: 'l1', apelido: 'ana', proprio: false, ordenada: true, tipo: null, qtd: 2, curtidas: 3, curti: true, comentarios: 1, capaItem: 'i1' })
  })

  it('mapeia os itens com tenho/li e número como número', async () => {
    const [i] = await carregarItensDaLista(
      cliente([{ id: 'i1', posicao: 1, obra_chave: 'k', titulo: 'T', serie_nome: 'S', numero_volume: '2.5', tipo: 'manga', capa: null, nota: 'n', spoiler: true, tenho: true, li: false }]),
      'l1'
    )
    expect(i).toMatchObject({ numeroVolume: 2.5, tipo: 'manga', spoiler: true, tenho: true, li: false })
  })

  it('erro do banco vira exceção', async () => {
    await expect(carregarListas(cliente(null, { message: 'falhou' }))).rejects.toThrow('falhou')
  })
})

describe('mensagens de erro das listas', () => {
  it.each([
    ['lista_nao_encontrada', 'Lista não encontrada.'],
    ['lista_item_repetido', 'Esta obra já está na lista.'],
    ['lista_cheia', 'Esta lista já tem 200 itens.'],
    ['lista_limite', 'Você chegou ao limite de 50 listas. Apague alguma para criar outra.'],
    ['comentario_rapido', 'Você está comentando rápido demais. Espere um minuto.'],
  ])('%s vira texto para o usuário', (codigo, texto) => {
    try {
      lancarErroRpc({ message: codigo })
    } catch (e) {
      expect(e).toBeInstanceOf(ErroDeNegocio)
      expect((e as Error).message).toBe(texto)
      return
    }
    throw new Error('deveria lançar')
  })
})
