import { describe, expect, it } from 'vitest'
import {
  anosParaPeriodo,
  avataresEmpilhados,
  carregarRankingAmigos,
  lerFiltrosAmigos,
  linhaDoRankingAmigos,
  pontuacaoSuavizada,
  rotuloDeAmigos,
  situacaoVazia,
} from '../ranking-amigos'

describe('pontuacaoSuavizada', () => {
  it('exemplo do estudo: 1 voto 5★ (C=3,5) = 4,25; 4 votos média 4,75 = 4,50', () => {
    expect(pontuacaoSuavizada(5, 1, 3.5)).toBe(4.25)
    expect(pontuacaoSuavizada(19, 4, 3.5)).toBe(4.5)
  })

  it('poucos votos puxam para C; muitos votos quase não mudam a média', () => {
    expect(pontuacaoSuavizada(0.5, 1, 3.5)).toBe(2)
    expect(pontuacaoSuavizada(500, 100, 3.5)).toBeCloseTo(4.985, 3)
  })

  it('padrão de C é 3,5 e m = 1', () => {
    expect(pontuacaoSuavizada(4, 1)).toBe(3.75)
  })
})

describe('lerFiltrosAmigos', () => {
  it('padrão: todos os tipos, melhor avaliados, sempre, incluindo os já lidos', () => {
    expect(lerFiltrosAmigos({})).toEqual({ tipo: undefined, ordem: 'nota', periodo: undefined, soNaoLidos: false })
  })

  it('lê tipo, ordem, período e "só os que eu não li"', () => {
    expect(lerFiltrosAmigos({ tipo: 'manga', ordem: 'lidos', periodo: '2025', nao_li: '1' })).toEqual({ tipo: 'manga', ordem: 'lidos', periodo: '2025', soNaoLidos: true })
    expect(lerFiltrosAmigos({ ordem: 'media', periodo: 'este-ano' }).periodo).toBe('este-ano')
    expect(lerFiltrosAmigos({ periodo: '12m' }).periodo).toBe('12m')
  })

  it('valor inválido é ignorado', () => {
    expect(lerFiltrosAmigos({ tipo: 'livro', ordem: 'x', periodo: 'ontem', nao_li: '0' })).toEqual({ tipo: undefined, ordem: 'nota', periodo: undefined, soNaoLidos: false })
  })
})

describe('exibição', () => {
  it('rótulo de amigos concorda no singular', () => {
    expect(rotuloDeAmigos(1)).toBe('1 amigo')
    expect(rotuloDeAmigos(3)).toBe('3 amigos')
  })

  it('avatares: até 3 e o "+N" do resto', () => {
    const av = (apelido: string) => ({ apelido, nome: null, avatarUrl: null })
    expect(avataresEmpilhados([av('a'), av('b')], 2)).toEqual({ visiveis: [av('a'), av('b')], extra: 0 })
    const tres = [av('a'), av('b'), av('c')]
    expect(avataresEmpilhados(tres, 3).extra).toBe(0)
    expect(avataresEmpilhados(tres, 7)).toEqual({ visiveis: tres, extra: 4 })
    expect(avataresEmpilhados([...tres, av('d')], 4)).toEqual({ visiveis: tres, extra: 1 })
  })

  it('anos do período: seis anos para trás e o ano pedido se ficou de fora', () => {
    const hoje = new Date(2026, 10, 17)
    expect(anosParaPeriodo(hoje)).toEqual([2026, 2025, 2024, 2023, 2022, 2021])
    expect(anosParaPeriodo(hoje, '2015')).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2015])
    expect(anosParaPeriodo(hoje, '2024')).toHaveLength(6)
    expect(anosParaPeriodo(hoje, 'este-ano')).toHaveLength(6)
  })
})

describe('situacaoVazia', () => {
  const estado = (amigos: number, amigosComNotas: number) => ({ amigos, amigosComNotas })
  it('com linhas não há aviso', () => {
    expect(situacaoVazia(estado(2, 2), 1, false)).toBeNull()
  })
  it('sem amigos convida a adicionar; amigos sem escopo explicam o interruptor', () => {
    expect(situacaoVazia(estado(0, 0), 0, false)).toBe('sem-amigos')
    expect(situacaoVazia(estado(3, 0), 0, true)).toBe('sem-escopo')
  })
  it('com escopo mas vazio: filtro explica, senão ninguém avaliou', () => {
    expect(situacaoVazia(estado(3, 1), 0, true)).toBe('sem-resultado')
    expect(situacaoVazia(estado(3, 1), 0, false)).toBe('sem-notas')
  })
})

describe('mapeamento da resposta da RPC', () => {
  const crua = {
    obra_chave: 'obra y|1|hq', isbn: '9781506711980', titulo: 'Obra Y', numero_volume: '1', serie_nome: 'Série', tem_numeracao: true, tipo: 'manga',
    n: 4, soma: '19', media: '4.7500', score: '4.5000', ultima_leitura: '2025-06-04',
    avatares: [{ apelido: 'beto', nome_exibicao: 'Beto', avatar_url: null }], minha_nota: null, meu_item_id: null,
    capa_publica: null, capa_item_id: 'abc', total: '6',
  }

  it('converte números e nulos', () => {
    const l = linhaDoRankingAmigos(crua)
    expect(l).toMatchObject({ obraChave: 'obra y|1|hq', numeroVolume: 1, tipo: 'manga', n: 4, soma: 19, media: 4.75, score: 4.5, minhaNota: null, meuItemId: null, capaItemId: 'abc' })
    expect(l.avatares).toEqual([{ apelido: 'beto', nome: 'Beto', avatarUrl: null }])
  })

  it('tipo desconhecido vira hq e avatares ausentes viram lista vazia', () => {
    const l = linhaDoRankingAmigos({ ...crua, tipo: null, avatares: null, minha_nota: '4.5' })
    expect(l.tipo).toBe('hq')
    expect(l.avatares).toEqual([])
    expect(l.minhaNota).toBe(4.5)
  })

  it('carregarRankingAmigos manda período e filtros para a RPC e lê o total', async () => {
    let chamada: { nome: string; args: Record<string, unknown> } | null = null
    const supabase = {
      rpc: async (nome: string, args: Record<string, unknown>) => {
        chamada = { nome, args }
        return { data: [crua], error: null }
      },
    }
    const r = await carregarRankingAmigos(supabase as never, { tipo: 'manga', ordem: 'lidos', periodo: 'este-ano', soNaoLidos: true }, 25, new Date(2026, 10, 17))
    expect(chamada).toEqual({
      nome: 'ranking_amigos',
      args: { p_tipo: 'manga', p_desde: '2026-01-01', p_ate: '2026-12-31', p_ordem: 'lidos', p_so_nao_lidos: true, p_limite: 25, p_offset: 0 },
    })
    expect(r.total).toBe(6)
    expect(r.linhas).toHaveLength(1)
  })

  it('"sempre" não manda datas e erro da RPC vira exceção', async () => {
    let args: Record<string, unknown> = {}
    const ok = { rpc: async (_n: string, a: Record<string, unknown>) => ((args = a), { data: [], error: null }) }
    expect((await carregarRankingAmigos(ok as never, { ordem: 'nota', soNaoLidos: false }, 25)).total).toBe(0)
    expect(args).toMatchObject({ p_desde: null, p_ate: null, p_tipo: null })
    const ruim = { rpc: async () => ({ data: null, error: { message: 'ordem_invalida' } }) }
    await expect(carregarRankingAmigos(ruim as never, { ordem: 'nota', soNaoLidos: false }, 25)).rejects.toThrow('ordem_invalida')
  })
})
