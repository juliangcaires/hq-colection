import { describe, expect, it, vi } from 'vitest'
import { avaliacaoDoPost, carregarFeed, ehPostDeLote, urlDeCapaDoVolumeDoLote, carregarOcultos, chaveDoPost, frasesDoResumo, reinserirPost, tempoRelativo, tituloDoPost, urlDeCapaDoFeed, type PostDoFeed } from '@/lib/feed'

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

  describe('capa do melhor volume (0032)', () => {
    const arquivo = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f-1700000000000.jpg'
    const melhor = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a-1700000000001.jpg'
    it('com melhor volume usa a capa dele e pede pelo id dele; sem melhor, a de sempre', () => {
      expect(urlDeCapaDoFeed({ capa: arquivo, itemId: 'quatro', capaDestaque: melhor, capaDestaqueItem: 'cinco' })).toBe('/feed/capa/cinco')
      expect(urlDeCapaDoFeed({ capa: arquivo, itemId: 'quatro', capaDestaque: null, capaDestaqueItem: null })).toBe('/feed/capa/quatro')
      expect(urlDeCapaDoFeed({ capa: arquivo, itemId: 'quatro' })).toBe('/feed/capa/quatro') // app/banco antes da 0032
    })
    it('a capa do melhor também é validada, e a do catálogo público não passa pela rota', () => {
      expect(urlDeCapaDoFeed({ capa: arquivo, itemId: 'quatro', capaDestaque: '../x.jpg', capaDestaqueItem: 'cinco' })).toBeNull()
      expect(urlDeCapaDoFeed({ capa: arquivo, itemId: 'quatro', capaDestaque: 'pub/abc', capaDestaqueItem: 'cinco' }) ?? '').not.toContain('/feed/capa/')
    })
    it('o feed repassa as colunas novas; ausentes viram nulo', async () => {
      const linha = { item_id: 'quatro', titulo: 'T', tipo: 'hq', marcado_em: '2026-11-17T12:00:00Z', qtd: 5 }
      const rpc = vi.fn(async () => ({ data: [{ ...linha, capa_destaque: melhor, capa_destaque_item: 'cinco' }, { ...linha, item_id: 'b' }], error: null }))
      const posts = await carregarFeed({ rpc } as never)
      expect(posts.map((p) => [p.capaDestaque, p.capaDestaqueItem])).toEqual([[melhor, 'cinco'], [null, null]])
    })
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

describe('spoiler na crítica (0024)', () => {
  const linha = { item_id: 'a', titulo: 'T', tipo: 'hq', marcado_em: '2026-11-17T12:00:00Z', critica: 'o final' }
  it('o feed repassa o flag; ausente ou nulo vira falso', async () => {
    const rpc = vi.fn(async () => ({ data: [{ ...linha, critica_spoiler: true }, { ...linha, item_id: 'b', critica_spoiler: false }, { ...linha, item_id: 'c' }, { ...linha, item_id: 'd', critica_spoiler: null }], error: null }))
    const posts = await carregarFeed({ rpc } as never)
    expect(posts.map((p) => p.criticaSpoiler)).toEqual([true, false, false, false])
  })
})

describe('releitura no feed (0025)', () => {
  const linha = { item_id: 'a', titulo: 'T', tipo: 'hq', marcado_em: '2026-11-17T12:00:00Z' }
  it('o feed repassa releitura e a leitura de origem; ausente vira "leu"', async () => {
    const rpc = vi.fn(async () => ({
      data: [{ ...linha, releitura: true, leitura_id: 'l1' }, { ...linha, releitura: false, leitura_id: null }, { ...linha, item_id: 'b' }],
      error: null,
    }))
    const posts = await carregarFeed({ rpc } as never)
    expect(posts.map((p) => [p.releitura, p.leituraId])).toEqual([[true, 'l1'], [false, null], [false, null]])
  })
  it('um volume pode ter o "leu" e vários "releu": a chave de cada post é diferente', () => {
    expect(chaveDoPost({ itemId: 'a', leituraId: null })).toBe('a')
    expect(chaveDoPost({ itemId: 'a', leituraId: 'l1' })).toBe('a:l1')
    expect(chaveDoPost({ itemId: 'a', leituraId: 'l2' })).not.toBe(chaveDoPost({ itemId: 'a', leituraId: 'l1' }))
  })
})

describe('avaliacaoDoPost (0031)', () => {
  const base = { qtd: 4, nota: null, critica: null, criticaSpoiler: false, notaMedia: null, avaliados: 0, criticaGrupo: null, criticaGrupoSpoiler: false, criticaGrupoVolume: null, serieNota: null, serieCritica: null }
  it('post de um volume: as do volume, como sempre', () => {
    expect(avaliacaoDoPost({ ...base, qtd: 1, nota: 4.5, critica: 'Bom', criticaSpoiler: true })).toEqual({ nota: 4.5, rotuloNota: null, critica: 'Bom', rotuloCritica: null, spoiler: true })
  })
  it('vários volumes: a avaliação da série vale mais que a média e a crítica dos volumes', () => {
    const a = avaliacaoDoPost({ ...base, serieNota: 5, serieCritica: 'Série inteira', notaMedia: 3, avaliados: 2, criticaGrupo: 'Volume', criticaGrupoVolume: 2 })
    expect(a).toMatchObject({ nota: 5, rotuloNota: 'Nota da série', critica: 'Série inteira', rotuloCritica: 'Crítica da série', spoiler: false })
  })
  it('vários volumes sem avaliação da série: média dos avaliados e a crítica de um volume (com o número)', () => {
    const a = avaliacaoDoPost({ ...base, notaMedia: 4.25, avaliados: 4, criticaGrupo: 'Final fraco', criticaGrupoSpoiler: true, criticaGrupoVolume: 3 })
    expect(a).toEqual({ nota: 4.25, rotuloNota: 'Média de 4 volumes', critica: 'Final fraco', rotuloCritica: 'Crítica do volume #3', spoiler: true })
    expect(avaliacaoDoPost({ ...base, notaMedia: 3, avaliados: 1 }).rotuloNota).toBe('Nota de 1 volume')
  })
  it('vários volumes sem nada visível: sem nota nem crítica', () => {
    expect(avaliacaoDoPost(base)).toEqual({ nota: null, rotuloNota: null, critica: null, rotuloCritica: null, spoiler: false })
  })
  it('o feed repassa as colunas novas; banco sem a 0031 (colunas ausentes) vira vazio', async () => {
    const nova = { item_id: 'a', titulo: 'T', tipo: 'hq', marcado_em: '2026-11-20T12:00:00Z', qtd: 4, nota_media: '4.50', avaliados: 3, critica_grupo: 'x', critica_grupo_spoiler: true, critica_grupo_volume: '2', serie_nota: '5', serie_critica: 'y' }
    const antiga = { item_id: 'b', titulo: 'T', tipo: 'hq', marcado_em: '2026-11-20T12:00:00Z' }
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: [nova, antiga], error: null }) } as never
    const [n, a] = await carregarFeed(supabase)
    expect(n).toMatchObject({ notaMedia: 4.5, avaliados: 3, criticaGrupo: 'x', criticaGrupoSpoiler: true, criticaGrupoVolume: 2, serieNota: 5, serieCritica: 'y' })
    expect(a).toMatchObject({ notaMedia: null, avaliados: 0, criticaGrupo: null, serieNota: null, serieCritica: null })
  })
})

describe('tirar do feed: reinserirPost e carregarOcultos (0031)', () => {
  const post = (id: string, marcadoEm: string) => ({ itemId: id, leituraId: null, marcadoEm }) as PostDoFeed
  const lista = [post('c', '2026-11-20T12:00:00Z'), post('b', '2026-11-19T12:00:00Z'), post('a', '2026-11-18T12:00:00Z')]
  it('desfazer devolve o post na posição de antes (ordem do mais recente ao mais antigo)', () => {
    const sem = lista.filter((p) => p.itemId !== 'b')
    expect(reinserirPost(sem, lista[1]).map((p) => p.itemId)).toEqual(['c', 'b', 'a'])
    expect(reinserirPost(sem.slice(1), lista[0]).map((p) => p.itemId)).toEqual(['c', 'a'])
    expect(reinserirPost(lista.slice(0, 2), lista[2]).map((p) => p.itemId)).toEqual(['c', 'b', 'a'])
  })
  it('não duplica quem já está na lista', () => {
    expect(reinserirPost(lista, lista[1])).toBe(lista)
  })
  it('carregarOcultos mapeia a lista; se o banco ainda não tem a função, devolve vazio', async () => {
    const ok = { rpc: vi.fn().mockResolvedValue({ data: [{ item_ids: ['1', '2'], item_id: '1', serie_nome: 'S', titulo: 'T', numero_volume: '2', qtd: 2, marcado_em: '2026-11-20T12:00:00Z' }], error: null }) } as never
    expect(await carregarOcultos(ok)).toEqual([{ itemIds: ['1', '2'], serieNome: 'S', titulo: 'T', numeroVolume: 2, qtd: 2, marcadoEm: '2026-11-20T12:00:00Z' }])
    const falha = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'function does not exist' } }) } as never
    expect(await carregarOcultos(falha)).toEqual([])
  })
})

describe('card de lote do "Li hoje" (0035)', () => {
  const arquivo = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f-1700000000000.jpg'
  const linha = { item_id: 'rep', titulo: 'T', tipo: 'hq', marcado_em: '2026-11-21T12:00:00Z', qtd: 3, serie_nome: null }
  const vol = (id: string, extra: object = {}) => ({ item_id: id, serie_nome: 'S', titulo: `T ${id}`, numero_volume: '2', capa: arquivo, nota: '4.5', critica: 'ok', critica_spoiler: true, ...extra })

  it('o feed repassa o lote e os volumes dele; sem a migration (ou fora de lote) vira nulo e o card é o de sempre', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        { ...linha, lote_id: 'L1', lote_itens: [vol('a'), vol('b', { nota: null, critica: null, critica_spoiler: false, serie_nome: null, numero_volume: null, capa: null }), vol('c')] },
        { ...linha, item_id: 'x', qtd: 1, lote_id: null, lote_itens: null },
        { ...linha, item_id: 'y' },
      ],
      error: null,
    }))
    const [lote, solto, antigo] = await carregarFeed({ rpc } as never)
    expect(lote.loteId).toBe('L1')
    expect(lote.loteItens).toHaveLength(3)
    expect(lote.loteItens![0]).toEqual({ itemId: 'a', serieNome: 'S', titulo: 'T a', numeroVolume: 2, capa: arquivo, nota: 4.5, critica: 'ok', criticaSpoiler: true })
    expect(lote.loteItens![1]).toMatchObject({ itemId: 'b', serieNome: null, numeroVolume: null, capa: null, nota: null, critica: null, criticaSpoiler: false })
    expect(ehPostDeLote(lote)).toBe(true)
    for (const p of [solto, antigo]) {
      expect(p).toMatchObject({ loteId: null, loteItens: null })
      expect(ehPostDeLote(p)).toBe(false)
    }
  })

  it('lista malformada não derruba o feed: vira "sem lote"; um volume só não é card de lote', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        { ...linha, lote_itens: [{ item_id: 5 }] },
        { ...linha, item_id: 'b', lote_itens: 'lixo' },
        { ...linha, item_id: 'c', lote_itens: [vol('a')] },
        { ...linha, item_id: 'd', lote_itens: [] },
      ],
      error: null,
    }))
    const posts = await carregarFeed({ rpc } as never)
    expect(posts.map((p) => ehPostDeLote(p))).toEqual([false, false, false, false])
  })

  it('o card mostra "N volumes" (sem nome de série) e a capa de cada volume sai pelo id dele', () => {
    expect(tituloDoPost({ serieNome: null, titulo: 'T', numeroVolume: null, qtd: 3 })).toBe('3 volumes')
    expect(urlDeCapaDoVolumeDoLote({ capa: arquivo, itemId: 'abc' })).toBe('/feed/capa/abc')
    expect(urlDeCapaDoVolumeDoLote({ capa: '../x.jpg', itemId: 'abc' })).toBeNull()
    expect(urlDeCapaDoVolumeDoLote({ capa: null, itemId: 'abc' })).toBeNull()
    expect(urlDeCapaDoVolumeDoLote({ capa: 'pub/abc', itemId: 'abc' }) ?? '').not.toContain('/feed/capa/')
  })

  it('curtir/comentar e "tirar do feed" valem para o card: a chave é a do volume que o representa', () => {
    expect(chaveDoPost({ itemId: 'rep', leituraId: null })).toBe('rep')
  })

  it('a nota do card é a média dos volumes avaliados (a série não entra: são várias)', () => {
    const a = avaliacaoDoPost({ qtd: 3, nota: 4, critica: null, criticaSpoiler: false, notaMedia: 4.25, avaliados: 2, criticaGrupo: null, criticaGrupoSpoiler: false, criticaGrupoVolume: null, serieNota: null, serieCritica: null })
    expect(a).toMatchObject({ nota: 4.25, rotuloNota: 'Média de 2 volumes' })
  })
})
