import { describe, expect, it, vi } from 'vitest'
import { carregarNotificacoes, contarNaoLidas, hrefDaNotificacao, nomeDoAutor, obraDaNotificacao, textoDaNotificacao, type Notificacao } from '@/lib/notificacoes'
import { rotuloDoContador } from '@/components/shell/notificacoes-provider'

const base: Notificacao = {
  id: 'n1',
  tipo: 'curtida',
  autorApelido: 'beto',
  autorNome: 'Beto',
  itemId: 'i1',
  serieNome: null,
  titulo: 'Decomposição',
  numeroVolume: null,
  criadoEm: '2026-11-21T12:00:00Z',
  lida: false,
}

describe('textoDaNotificacao', () => {
  it('curtida e comentário citam a obra (título ou "Série #n"), sem crítica nem texto do comentário', () => {
    expect(textoDaNotificacao(base)).toBe('Beto curtiu sua leitura de Decomposição')
    expect(textoDaNotificacao({ ...base, tipo: 'comentario', autorNome: 'Ana' })).toBe('Ana comentou na sua leitura de Decomposição')
    expect(textoDaNotificacao({ ...base, serieNome: 'Berserk', titulo: 'A Espada', numeroVolume: 3 })).toBe('Beto curtiu sua leitura de Berserk #3')
  })
  it('amizade: pedido e aceite, em texto neutro quanto ao gênero', () => {
    expect(textoDaNotificacao({ ...base, tipo: 'amizade_pedido', itemId: null, titulo: null, autorNome: 'Carla' })).toBe('Carla enviou um pedido de amizade')
    expect(textoDaNotificacao({ ...base, tipo: 'amizade_aceita', itemId: null, titulo: null, autorNome: 'Dani' })).toBe('Dani aceitou seu pedido de amizade')
  })
  it('sem nome usa o apelido; sem nenhum, "Alguém"; sem obra, o texto não quebra; tipo desconhecido tem texto genérico', () => {
    expect(nomeDoAutor({ autorNome: null, autorApelido: 'caio' })).toBe('caio')
    expect(nomeDoAutor({ autorNome: '  ', autorApelido: null })).toBe('Alguém')
    expect(textoDaNotificacao({ ...base, titulo: null })).toBe('Beto curtiu sua leitura')
    expect(obraDaNotificacao({ serieNome: null, titulo: null, numeroVolume: null })).toBe('')
    expect(textoDaNotificacao({ ...base, tipo: 'futuro' })).toBe('Você tem uma notificação nova')
  })
})

describe('hrefDaNotificacao', () => {
  it('curtida e comentário levam ao feed; pedido a Amigos; aceite ao perfil do amigo (apelido seguro) ou a Amigos', () => {
    expect(hrefDaNotificacao({ tipo: 'curtida', autorApelido: 'beto' })).toBe('/feed')
    expect(hrefDaNotificacao({ tipo: 'comentario', autorApelido: 'beto' })).toBe('/feed')
    expect(hrefDaNotificacao({ tipo: 'amizade_pedido', autorApelido: 'carla' })).toBe('/amigos')
    expect(hrefDaNotificacao({ tipo: 'amizade_aceita', autorApelido: 'dani' })).toBe('/amigos/dani')
    expect(hrefDaNotificacao({ tipo: 'amizade_aceita', autorApelido: '../x?y' })).toBe('/amigos')
    expect(hrefDaNotificacao({ tipo: 'amizade_aceita', autorApelido: null })).toBe('/amigos')
    expect(hrefDaNotificacao({ tipo: 'futuro', autorApelido: null })).toBe('/notificacoes')
  })
})

describe('carregarNotificacoes / contarNaoLidas', () => {
  it('repassa as colunas; numero_volume vira número e ausentes viram nulo', async () => {
    const rpc = vi.fn(async () => ({
      data: [{ id: 'a', tipo: 'curtida', autor_apelido: 'beto', autor_nome: null, item_id: 'i', serie_nome: 'S', titulo: 'T', numero_volume: '2', criado_em: '2026-11-21T12:00:00Z', lida: true }, { id: 'b', tipo: 'amizade_pedido', criado_em: '2026-11-21T11:00:00Z' }],
      error: null,
    }))
    const lista = await carregarNotificacoes({ rpc } as never, '2026-11-22T00:00:00Z', 10)
    expect(rpc).toHaveBeenCalledWith('notificacoes_listar', { p_limite: 10, p_antes: '2026-11-22T00:00:00Z' })
    expect(lista[0]).toMatchObject({ id: 'a', numeroVolume: 2, lida: true, autorNome: null, serieNome: 'S' })
    expect(lista[1]).toMatchObject({ id: 'b', itemId: null, titulo: null, numeroVolume: null, lida: false })
  })
  it('erro ao listar lança; o contador nunca lança (erro vira 0)', async () => {
    await expect(carregarNotificacoes({ rpc: async () => ({ data: null, error: { message: 'boom' } }) } as never)).rejects.toThrow('boom')
    expect(await contarNaoLidas({ rpc: async () => ({ data: null, error: { message: 'function does not exist' } }) } as never)).toBe(0)
    expect(await contarNaoLidas({ rpc: async () => ({ data: 3, error: null }) } as never)).toBe(3)
    expect(await contarNaoLidas({ rpc: async () => ({ data: null, error: null }) } as never)).toBe(0)
  })
})

describe('rotuloDoContador', () => {
  it('passa de nove vira "9+"', () => {
    expect(rotuloDoContador(1)).toBe('1')
    expect(rotuloDoContador(9)).toBe('9')
    expect(rotuloDoContador(10)).toBe('9+')
  })
})
