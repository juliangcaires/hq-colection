import { describe, expect, it } from 'vitest'
import {
  anoEmDestaque,
  anosDoSeletor,
  anosComLeitura,
  calcularEstatisticasDoAno,
  compararComAmigos,
  dataDeConclusaoDaSerie,
  escolherAnoDasEstatisticas,
  maiorSequenciaDeMeses,
  volumeDaLinha,
  type DadosParaEstatisticas,
  type VolumeParaEstatistica,
} from '@/lib/estatisticas'

const vol = (id: string, extra: Partial<VolumeParaEstatistica> = {}): VolumeParaEstatistica => ({
  id,
  titulo: `Vol ${id}`,
  numeroVolume: null,
  tipo: 'hq',
  estado: 'lido',
  varianteDe: null,
  nota: null,
  capaUrl: null,
  dataAquisicao: null,
  serieId: null,
  tags: [],
  ...extra,
})

let seq = 0
const leitura = (itemId: string, lidoEm: string, criadoEm = `${lidoEm}T12:00:00Z`) => ({ id: `l${String(++seq).padStart(3, '0')}`, itemId, lidoEm, criadoEm })

const dados = (p: Partial<DadosParaEstatisticas>): DadosParaEstatisticas => ({ volumes: [], series: [], leituras: [], emprestimos: [], ...p })

describe('ano sem dados', () => {
  it('vem vazio, sem quebrar, e o ano escolhido cai no corrente', () => {
    const e = calcularEstatisticasDoAno(dados({}), 2026)
    expect(e.vazio).toBe(true)
    expect(e.leituras).toBe(0)
    expect(e.porMes).toEqual(Array(12).fill(0))
    expect(e.mesMaisAtivo).toBeNull()
    expect(e.mediaDasNotas).toBeNull()
    expect(e.maiorSequencia).toBeNull()
    expect(e.serieMaisLida).toBeNull()
    expect(e.top5).toEqual([])
    expect(e.primeiraLeitura).toBeNull()
    expect(e.ultimaLeitura).toBeNull()
    expect(escolherAnoDasEstatisticas(undefined, [], 2026)).toBe(2026)
  })

  it('escolha do ano: pedido plausível vale (mesmo sem leitura); lixo e futuro caem no padrão', () => {
    expect(escolherAnoDasEstatisticas('2024', [2026, 2025], 2026)).toBe(2024)
    expect(escolherAnoDasEstatisticas('2030', [2026, 2025], 2026)).toBe(2026)
    expect(escolherAnoDasEstatisticas('lixo', [2025], 2026)).toBe(2025)
    expect(escolherAnoDasEstatisticas('20', [2025], 2026)).toBe(2025)
    expect(anosDoSeletor([2025], 2026, 2025)).toEqual([2026, 2025])
    expect(anosDoSeletor([], 2026, 2026)).toEqual([])
  })

  it('o ano pedido sem leitura é vazio mesmo havendo dados em outro ano', () => {
    const e = calcularEstatisticasDoAno(dados({ volumes: [vol('a')], leituras: [leitura('a', '2025-05-01')] }), 2026)
    expect(e.vazio).toBe(true)
  })
})

describe('releitura entra na contagem', () => {
  const d = dados({
    volumes: [vol('a', { nota: 4 }), vol('b', { nota: 5 })],
    leituras: [leitura('a', '2025-03-10'), leitura('a', '2026-02-05'), leitura('a', '2026-08-20'), leitura('b', '2026-02-07')],
  })
  const e = calcularEstatisticasDoAno(d, 2026)

  it('conta todas as leituras do ano e separa as releituras', () => {
    expect(e.leituras).toBe(3)
    expect(e.releituras).toBe(2)
    expect(e.volumesDistintos).toBe(2)
    expect(e.porMes[1]).toBe(2)
    expect(e.porMes[7]).toBe(1)
  })

  it('releitura é decidida na história inteira: a leitura de 2025 foi a primeira, a de 2026 já é releitura', () => {
    expect(calcularEstatisticasDoAno(d, 2025).releituras).toBe(0)
    expect(e.compradosXLidos.lidosPelaPrimeiraVez).toBe(1) // só o volume b
  })

  it('a nota entra uma vez por volume, mesmo lido duas vezes no ano', () => {
    expect(e.mediaDasNotas).toEqual({ media: 4.5, avaliados: 2 })
  })

  it('primeira e última leitura do ano', () => {
    expect(e.primeiraLeitura?.lidoEm).toBe('2026-02-05')
    expect(e.ultimaLeitura?.lidoEm).toBe('2026-08-20')
    expect(e.mesMaisAtivo).toEqual({ mes: 2, leituras: 2 })
  })
})

describe('ano virando', () => {
  const d = dados({
    volumes: [vol('a'), vol('b'), vol('c', { tipo: 'manga' })],
    leituras: [leitura('a', '2025-12-31'), leitura('b', '2026-01-01'), leitura('c', '2026-02-10')],
  })

  it('31/12 é de um ano e 01/01 do outro', () => {
    expect(calcularEstatisticasDoAno(d, 2025).leituras).toBe(1)
    expect(calcularEstatisticasDoAno(d, 2026).leituras).toBe(2)
    expect(anosComLeitura(d.leituras)).toEqual([2026, 2025])
  })

  it('a sequência de meses não atravessa a virada do ano', () => {
    const e2026 = calcularEstatisticasDoAno(d, 2026)
    expect(e2026.maiorSequencia).toEqual({ meses: 2, deMes: 1, ateMes: 2 })
    expect(calcularEstatisticasDoAno(d, 2025).maiorSequencia).toEqual({ meses: 1, deMes: 12, ateMes: 12 })
  })

  it('HQ × mangá', () => {
    expect(calcularEstatisticasDoAno(d, 2026).porTipo).toEqual({ hq: 1, manga: 1 })
  })

  it('destaque: dezembro mostra o ano corrente, janeiro o anterior, só com leitura', () => {
    expect(anoEmDestaque('2026-12-05', [2026, 2025])).toBe(2026)
    expect(anoEmDestaque('2027-01-03', [2026])).toBe(2026)
    expect(anoEmDestaque('2027-01-03', [2025])).toBeNull()
    expect(anoEmDestaque('2026-06-15', [2026])).toBeNull()
    expect(anoEmDestaque('2026-12-05', [])).toBeNull()
  })
})

describe('maiorSequenciaDeMeses', () => {
  it('acha a maior e, no empate, fica com a mais antiga', () => {
    expect(maiorSequenciaDeMeses([1, 2, 3, 5, 6, 7, 9])).toEqual({ meses: 3, deMes: 1, ateMes: 3 })
    expect(maiorSequenciaDeMeses([2, 4, 5, 6, 7])).toEqual({ meses: 4, deMes: 4, ateMes: 7 })
    expect(maiorSequenciaDeMeses([3, 3, 3])).toEqual({ meses: 1, deMes: 3, ateMes: 3 })
    expect(maiorSequenciaDeMeses([])).toBeNull()
  })
})

describe('séries iniciadas e concluídas', () => {
  const serie = { id: 's1', nome: 'Saga', totalVolumes: 3, emPublicacao: false }
  const tres = (estados: ('lido' | 'comprado')[]) => estados.map((estado, i) => vol(`v${i + 1}`, { serieId: 's1', estado, numeroVolume: i + 1 }))

  it('conclui no ano da primeira leitura do último volume; iniciada no ano da primeira leitura da série', () => {
    const d = dados({
      series: [serie],
      volumes: tres(['lido', 'lido', 'lido']),
      leituras: [leitura('v1', '2025-11-01'), leitura('v2', '2026-01-10'), leitura('v3', '2026-03-05'), leitura('v1', '2026-06-01')],
    })
    const e25 = calcularEstatisticasDoAno(d, 2025)
    const e26 = calcularEstatisticasDoAno(d, 2026)
    expect(e25.seriesIniciadas.map((s) => s.nome)).toEqual(['Saga'])
    expect(e25.seriesConcluidas).toEqual([])
    expect(e26.seriesIniciadas).toEqual([])
    expect(e26.seriesConcluidas.map((s) => s.nome)).toEqual(['Saga'])
    // a releitura do vol. 1 em 2026 não muda o ano de conclusão
    expect(e26.serieMaisLida).toMatchObject({ nome: 'Saga', leituras: 3, volumes: 3 })
  })

  it('série incompleta (volume só comprado, ou menos volumes que o total) não está concluída', () => {
    const lidas = [leitura('v1', '2026-01-10'), leitura('v2', '2026-02-10'), leitura('v3', '2026-03-10')]
    const comprado = dados({ series: [serie], volumes: tres(['lido', 'lido', 'comprado']), leituras: lidas.slice(0, 2) })
    expect(calcularEstatisticasDoAno(comprado, 2026).seriesConcluidas).toEqual([])
    expect(calcularEstatisticasDoAno(comprado, 2026).seriesIniciadas).toHaveLength(1)

    const faltaVolume = dados({ series: [serie], volumes: tres(['lido', 'lido', 'lido']).slice(0, 2), leituras: lidas.slice(0, 2) })
    expect(calcularEstatisticasDoAno(faltaVolume, 2026).seriesConcluidas).toEqual([])
  })

  it('série em publicação sem total declarado não conclui; encerrada sem total conclui quando tudo foi lido', () => {
    const volumes = tres(['lido', 'lido', 'lido'])
    const leituras = [leitura('v1', '2026-01-10'), leitura('v2', '2026-02-10'), leitura('v3', '2026-03-10')]
    const emAndamento = dados({ series: [{ ...serie, totalVolumes: null, emPublicacao: true }], volumes, leituras })
    expect(calcularEstatisticasDoAno(emAndamento, 2026).seriesConcluidas).toEqual([])
    const encerrada = dados({ series: [{ ...serie, totalVolumes: null, emPublicacao: false }], volumes, leituras })
    expect(calcularEstatisticasDoAno(encerrada, 2026).seriesConcluidas).toHaveLength(1)
  })

  it('volume lido sem data (sem leitura) deixa a data de conclusão desconhecida', () => {
    const volumes = tres(['lido', 'lido', 'lido'])
    const primeira = new Map([['v1', '2026-01-10'], ['v2', '2026-02-10']])
    expect(dataDeConclusaoDaSerie(serie, volumes, primeira)).toBeNull()
    primeira.set('v3', '2026-04-01')
    expect(dataDeConclusaoDaSerie(serie, volumes, primeira)).toBe('2026-04-01')
  })

  it('variante e desejo não atrapalham a conclusão', () => {
    const volumes = [...tres(['lido', 'lido', 'lido']), vol('v1b', { serieId: 's1', estado: 'comprado', varianteDe: 'v1' }), vol('v4', { serieId: 's1', estado: 'desejo' })]
    const primeira = new Map([['v1', '2026-01-10'], ['v2', '2026-02-10'], ['v3', '2026-04-01']])
    expect(dataDeConclusaoDaSerie(serie, volumes, primeira)).toBe('2026-04-01')
  })
})

describe('editoras, tags, comprados × lidos e empréstimos', () => {
  const panini = { id: 't1', nome: 'Panini', tipo: 'editora' as const }
  const batman = { id: 't2', nome: 'Batman', tipo: 'personagem' as const }
  const d = dados({
    volumes: [
      vol('a', { tags: [panini, batman], dataAquisicao: '2026-01-05' }),
      vol('b', { tags: [panini], dataAquisicao: '2026-02-05' }),
      vol('c', { estado: 'comprado', dataAquisicao: '2026-03-05' }),
      vol('c2', { estado: 'comprado', varianteDe: 'c', dataAquisicao: '2026-03-05' }),
      vol('d', { estado: 'desejo', dataAquisicao: '2026-04-05' }),
      vol('e', { estado: 'comprado', dataAquisicao: '2025-12-31' }),
    ],
    leituras: [leitura('a', '2026-02-01'), leitura('a', '2026-05-01'), leitura('b', '2026-05-02')],
    emprestimos: [
      { emprestadoEm: '2026-01-10', devolvidoEm: '2026-02-01' },
      { emprestadoEm: '2025-12-20', devolvidoEm: '2026-01-02' },
      { emprestadoEm: '2026-06-01', devolvidoEm: null },
    ],
  })
  const e = calcularEstatisticasDoAno(d, 2026)

  it('editoras separadas das demais tags, por leitura', () => {
    expect(e.editoras).toEqual([{ nome: 'Panini', leituras: 3 }])
    expect(e.tags).toEqual([{ nome: 'Batman', leituras: 2 }])
  })

  it('comprados: só com data no ano, sem desejo e sem variante; fila = comprados ainda não lidos', () => {
    expect(e.compradosXLidos).toEqual({ comprados: 3, lidosPelaPrimeiraVez: 2, naFilaAgora: 2 })
  })

  it('empréstimos feitos, devolvidos e abertos', () => {
    expect(e.emprestimos).toEqual({ feitos: 2, devolvidos: 2, abertos: 1 })
  })
})

describe('top 5 e série mais lida', () => {
  it('ordena por nota, depois pela leitura mais recente, e ignora volumes sem nota', () => {
    const volumes = [
      vol('a', { nota: 5 }),
      vol('b', { nota: 5 }),
      vol('c', { nota: 4.5 }),
      vol('d', { nota: 4 }),
      vol('e', { nota: 3.5 }),
      vol('f', { nota: 3 }),
      vol('g'),
    ]
    const leituras = [leitura('a', '2026-01-01'), leitura('b', '2026-02-01'), leitura('c', '2026-03-01'), leitura('d', '2026-04-01'), leitura('e', '2026-05-01'), leitura('f', '2026-06-01'), leitura('g', '2026-07-01')]
    const e = calcularEstatisticasDoAno(dados({ volumes, leituras }), 2026)
    expect(e.top5.map((v) => v.itemId)).toEqual(['b', 'a', 'c', 'd', 'e'])
  })

  it('leitura de volume que não existe mais é ignorada', () => {
    const e = calcularEstatisticasDoAno(dados({ volumes: [vol('a')], leituras: [leitura('a', '2026-01-01'), leitura('fantasma', '2026-01-02')] }), 2026)
    expect(e.leituras).toBe(1)
  })
})

describe('comparação com a média dos amigos', () => {
  const minhas = new Map([['a', 5], ['b', 3], ['c', 4], ['d', 2]])
  it('conta acima, abaixo e iguais só dos volumes lidos no ano', () => {
    const r = compararComAmigos(minhas, [
      { meuItemId: 'a', minhaNota: 5, media: 4 }, // +1
      { meuItemId: 'b', minhaNota: 3, media: 4.5 }, // -1,5
      { meuItemId: 'c', minhaNota: 4, media: 4 }, // 0
      { meuItemId: 'z', minhaNota: 5, media: 1 }, // não lido no ano: fora
      { meuItemId: 'd', minhaNota: null, media: 3 }, // sem nota minha: fora
      { meuItemId: null, minhaNota: 4, media: 3 },
    ])
    expect(r).toEqual({ comparados: 3, acima: 1, abaixo: 1, iguais: 1, diferencaMedia: -0.17 })
  })
  it('sem nenhum volume em comum, não há comparação', () => {
    expect(compararComAmigos(minhas, [])).toBeNull()
    expect(compararComAmigos(new Map(), [{ meuItemId: 'a', minhaNota: 5, media: 4 }])).toBeNull()
  })
})

describe('volumeDaLinha', () => {
  it('junta as tags do volume e da série sem repetir', () => {
    const t = { id: 't1', nome: 'Panini', tipo: 'editora' as const }
    const v = volumeDaLinha({
      id: 'a',
      titulo: 'X',
      numero_volume: '2',
      tipo: 'hq',
      estado: 'lido',
      variante_de: null,
      nota: '4.5',
      capa_url: null,
      data_aquisicao: null,
      serie_id: 's',
      item_tags: [{ tag: t }],
      serie: { serie_tags: [{ tag: [t] }, { tag: { id: 't2', nome: 'Batman', tipo: 'personagem' } }] },
    })
    expect(v.numeroVolume).toBe(2)
    expect(v.nota).toBe(4.5)
    expect(v.tags.map((x) => x.id).sort()).toEqual(['t1', 't2'])
  })
})
