import type { SupabaseClient } from '@supabase/supabase-js'
import { lerTodasAsLinhas } from '@/lib/paginar'
import { marcarReleituras } from '@/lib/leituras'
import { serieEstaLida } from '@/lib/volumes'
import type { EstadoItem, TipoObra, TipoTag } from '@/lib/types'

/**
 * Estatísticas pessoais e "Seu ano em HQ" (R6). Tudo calculado no app, em cima das leituras (migration 0025):
 * leitura = um registro de `leituras`, releitura inclusa. Sem migration; o banco só entrega as linhas da própria
 * pessoa (RLS) e as funções daqui, puras, fazem as contas.
 *
 * Decisões (as mais conservadoras):
 *  * o ano de uma leitura é o ano de `lido_em` (texto AAAA-MM-DD, sem passar por Date: não muda de dia por fuso);
 *  * volume lido sem data (marcado antes da 0010) não tem leitura: fica fora de tudo que depende de data;
 *  * a nota é uma por volume (não por leitura): a média do ano usa a nota atual dos volumes lidos no ano, uma vez cada;
 *  * variante (outra capa) nunca tem leitura e não conta como volume comprado.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

export type TagDoVolume = { id: string; nome: string; tipo: TipoTag }

export type VolumeParaEstatistica = {
  id: string
  titulo: string
  numeroVolume: number | null
  tipo: TipoObra
  estado: EstadoItem
  varianteDe: string | null
  nota: number | null
  capaUrl: string | null
  /** AAAA-MM-DD */
  dataAquisicao: string | null
  serieId: string | null
  /** Tags do volume e da série, sem repetir. */
  tags: TagDoVolume[]
}

export type SerieParaEstatistica = {
  id: string
  nome: string
  totalVolumes: number | null
  emPublicacao: boolean
}

export type LeituraParaEstatistica = { id: string; itemId: string; lidoEm: string; criadoEm: string }

export type EmprestimoParaEstatistica = { emprestadoEm: string; devolvidoEm: string | null }

export type DadosParaEstatisticas = {
  volumes: VolumeParaEstatistica[]
  series: SerieParaEstatistica[]
  leituras: LeituraParaEstatistica[]
  emprestimos: EmprestimoParaEstatistica[]
}

export type VolumeLido = {
  itemId: string
  titulo: string
  numeroVolume: number | null
  serieNome: string | null
  tipo: TipoObra
  capaUrl: string | null
  nota: number | null
}

export type LeituraDoAno = VolumeLido & { leituraId: string; lidoEm: string; releitura: boolean }

export type ContagemNomeada = { nome: string; leituras: number }

export type SerieDoAno = { id: string; nome: string; leituras: number; volumes: number }

export type EstatisticasDoAno = {
  ano: number
  /** Nenhuma leitura no ano: a tela mostra o estado vazio. */
  vazio: boolean
  leituras: number
  releituras: number
  /** Volumes diferentes lidos no ano (releitura do mesmo volume no ano conta uma vez). */
  volumesDistintos: number
  /** 12 posições, janeiro a dezembro. */
  porMes: number[]
  mesMaisAtivo: { mes: number; leituras: number } | null
  porTipo: { hq: number; manga: number }
  seriesIniciadas: SerieDoAno[]
  seriesConcluidas: SerieDoAno[]
  serieMaisLida: SerieDoAno | null
  editoras: ContagemNomeada[]
  tags: ContagemNomeada[]
  mediaDasNotas: { media: number; avaliados: number } | null
  /** Maior sequência de meses seguidos com leitura DENTRO do ano (não atravessa a virada). */
  maiorSequencia: { meses: number; deMes: number; ateMes: number } | null
  /** Volumes comprados com data no ano × volumes lidos pela primeira vez no ano. */
  compradosXLidos: { comprados: number; lidosPelaPrimeiraVez: number; naFilaAgora: number }
  emprestimos: { feitos: number; devolvidos: number; abertos: number }
  top5: VolumeLido[]
  primeiraLeitura: LeituraDoAno | null
  ultimaLeitura: LeituraDoAno | null
}

const noAno = (data: string | null | undefined, ano: number): boolean => !!data && data.startsWith(`${ano}-`)
const mesDe = (data: string): number => Number(data.slice(5, 7))
const anoDe = (data: string): number => Number(data.slice(0, 4))

/** Anos com leitura, do mais recente ao mais antigo. */
export function anosComLeitura(leituras: Pick<LeituraParaEstatistica, 'lidoEm'>[]): number[] {
  return [...new Set(leituras.map((l) => anoDe(l.lidoEm)))].filter((a) => a > 1900).sort((a, b) => b - a)
}

/**
 * Ano mostrado: o pedido, se for um ano plausível (1900 até o corrente; ano sem leitura mostra o estado vazio);
 * senão o corrente se tiver leitura; senão o mais recente com leitura; senão o corrente.
 */
export function escolherAnoDasEstatisticas(pedido: string | undefined, anos: number[], anoAtual: number): number {
  const p = Number(pedido)
  if (/^\d{4}$/.test(pedido ?? '') && p >= 1900 && p <= anoAtual) return p
  if (anos.includes(anoAtual)) return anoAtual
  return anos[0] ?? anoAtual
}

/** Anos do seletor: os com leitura e o corrente (para abrir o estado vazio), do mais recente ao mais antigo. */
export function anosDoSeletor(anos: number[], anoAtual: number, escolhido: number): number[] {
  if (anos.length === 0) return []
  return [...new Set([...anos, anoAtual, escolhido])].sort((a, b) => b - a)
}

/** Maior sequência de meses consecutivos (1–12) presentes em `meses`; empate fica com a mais antiga. */
export function maiorSequenciaDeMeses(meses: number[]): { meses: number; deMes: number; ateMes: number } | null {
  const ordenados = [...new Set(meses)].sort((a, b) => a - b)
  let melhor: { meses: number; deMes: number; ateMes: number } | null = null
  let inicio = 0
  for (let i = 0; i < ordenados.length; i++) {
    if (i > 0 && ordenados[i] !== ordenados[i - 1] + 1) inicio = i
    const tamanho = i - inicio + 1
    if (!melhor || tamanho > melhor.meses) melhor = { meses: tamanho, deMes: ordenados[inicio], ateMes: ordenados[i] }
  }
  return melhor
}

/**
 * Data (AAAA-MM-DD) em que a série foi concluída, ou null. Concluída = todos os volumes possuídos lidos (`serieEstaLida`)
 * e a série não tem como ter mais volume: o total declarado foi atingido (série incompleta não conta) ou, sem total,
 * ela está encerrada. A data é a da PRIMEIRA leitura do último volume a ser lido pela primeira vez; se algum volume lido
 * não tem data, a data é desconhecida e a série não entra em ano nenhum.
 */
export function dataDeConclusaoDaSerie(
  serie: SerieParaEstatistica,
  volumes: VolumeParaEstatistica[],
  primeiraLeituraPorVolume: Map<string, string>
): string | null {
  const doConjunto = volumes.filter((v) => v.serieId === serie.id)
  if (!serieEstaLida(doConjunto.map((v) => ({ estado: v.estado, variante_de: v.varianteDe })))) return null
  const possuidos = doConjunto.filter((v) => v.estado !== 'desejo' && !v.varianteDe)
  if (serie.totalVolumes && serie.totalVolumes > 0) {
    if (possuidos.length < serie.totalVolumes) return null
  } else if (serie.emPublicacao) {
    return null
  }
  let ultima: string | null = null
  for (const v of possuidos) {
    const primeira = primeiraLeituraPorVolume.get(v.id)
    if (!primeira) return null
    if (!ultima || primeira > ultima) ultima = primeira
  }
  return ultima
}

function contar(nomes: string[]): ContagemNomeada[] {
  const mapa = new Map<string, number>()
  for (const n of nomes) mapa.set(n, (mapa.get(n) ?? 0) + 1)
  return [...mapa]
    .map(([nome, leituras]) => ({ nome, leituras }))
    .sort((a, b) => b.leituras - a.leituras || a.nome.localeCompare(b.nome, 'pt-BR'))
}

const porData = (a: LeituraDoAno, b: LeituraDoAno) => a.lidoEm.localeCompare(b.lidoEm) || a.leituraId.localeCompare(b.leituraId)

export function calcularEstatisticasDoAno(dados: DadosParaEstatisticas, ano: number, limite = 5): EstatisticasDoAno {
  const volumePorId = new Map(dados.volumes.map((v) => [v.id, v]))
  const seriePorId = new Map(dados.series.map((s) => [s.id, s]))

  // Releitura é decidida na história inteira: a 1ª leitura de um volume nunca é releitura, mesmo que em outro ano.
  const todas = marcarReleituras(
    dados.leituras
      .filter((l) => volumePorId.has(l.itemId))
      .map((l) => ({ id: l.id, item_id: l.itemId, lido_em: l.lidoEm, criado_em: l.criadoEm }))
  )

  const primeiraPorVolume = new Map<string, string>()
  for (const l of todas) {
    const atual = primeiraPorVolume.get(l.item_id)
    if (!atual || l.lido_em < atual) primeiraPorVolume.set(l.item_id, l.lido_em)
  }

  const doVolume = (id: string): VolumeLido => {
    const v = volumePorId.get(id)!
    return {
      itemId: v.id,
      titulo: v.titulo,
      numeroVolume: v.numeroVolume,
      serieNome: (v.serieId && seriePorId.get(v.serieId)?.nome) || null,
      tipo: v.tipo,
      capaUrl: v.capaUrl,
      nota: v.nota,
    }
  }

  const doAno: LeituraDoAno[] = todas
    .filter((l) => noAno(l.lido_em, ano))
    .map((l) => ({ ...doVolume(l.item_id), leituraId: l.id, lidoEm: l.lido_em, releitura: l.releitura }))
    .sort(porData)

  const porMes = Array.from({ length: 12 }, () => 0)
  for (const l of doAno) porMes[mesDe(l.lidoEm) - 1]++
  let mesMaisAtivo: EstatisticasDoAno['mesMaisAtivo'] = null
  porMes.forEach((n, i) => {
    if (n > 0 && (!mesMaisAtivo || n > mesMaisAtivo.leituras)) mesMaisAtivo = { mes: i + 1, leituras: n }
  })

  const idsDistintos = [...new Set(doAno.map((l) => l.itemId))]
  const porTipo = { hq: 0, manga: 0 }
  for (const l of doAno) porTipo[l.tipo]++

  // Séries: iniciada = primeira leitura de qualquer volume dela no ano; concluída = `dataDeConclusaoDaSerie` no ano.
  const primeiraPorSerie = new Map<string, string>()
  for (const [id, data] of primeiraPorVolume) {
    const sid = volumePorId.get(id)?.serieId
    if (!sid) continue
    const atual = primeiraPorSerie.get(sid)
    if (!atual || data < atual) primeiraPorSerie.set(sid, data)
  }
  const leiturasDaSerieNoAno = new Map<string, { leituras: number; volumes: Set<string> }>()
  for (const l of doAno) {
    const sid = volumePorId.get(l.itemId)?.serieId
    if (!sid) continue
    const reg = leiturasDaSerieNoAno.get(sid) ?? { leituras: 0, volumes: new Set<string>() }
    reg.leituras++
    reg.volumes.add(l.itemId)
    leiturasDaSerieNoAno.set(sid, reg)
  }
  const refDaSerie = (s: SerieParaEstatistica): SerieDoAno => {
    const reg = leiturasDaSerieNoAno.get(s.id)
    return { id: s.id, nome: s.nome, leituras: reg?.leituras ?? 0, volumes: reg?.volumes.size ?? 0 }
  }
  const porNome = (a: SerieDoAno, b: SerieDoAno) => a.nome.localeCompare(b.nome, 'pt-BR') || a.id.localeCompare(b.id)
  const seriesIniciadas = dados.series.filter((s) => noAno(primeiraPorSerie.get(s.id), ano)).map(refDaSerie).sort(porNome)
  const seriesConcluidas = dados.series
    .filter((s) => noAno(dataDeConclusaoDaSerie(s, dados.volumes, primeiraPorVolume), ano))
    .map(refDaSerie)
    .sort(porNome)
  const serieMaisLida =
    [...leiturasDaSerieNoAno.keys()]
      .map((id) => seriePorId.get(id))
      .filter((s): s is SerieParaEstatistica => !!s)
      .map(refDaSerie)
      .sort((a, b) => b.leituras - a.leituras || b.volumes - a.volumes || porNome(a, b))[0] ?? null

  // Tags e editoras: cada leitura conta uma vez por tag (a do volume e a da série, sem repetir).
  const nomesEditoras: string[] = []
  const nomesTags: string[] = []
  for (const l of doAno) {
    for (const t of volumePorId.get(l.itemId)!.tags) (t.tipo === 'editora' ? nomesEditoras : nomesTags).push(t.nome)
  }

  const notas = idsDistintos.map((id) => volumePorId.get(id)!.nota).filter((n): n is number => n !== null)
  const mediaDasNotas = notas.length > 0 ? { media: notas.reduce((a, b) => a + b, 0) / notas.length, avaliados: notas.length } : null

  const top5 = idsDistintos
    .map((id) => ({ ...doVolume(id), ultima: doAno.filter((l) => l.itemId === id).at(-1)!.lidoEm }))
    .filter((v) => v.nota !== null)
    .sort((a, b) => b.nota! - a.nota! || b.ultima.localeCompare(a.ultima) || a.titulo.localeCompare(b.titulo, 'pt-BR') || a.itemId.localeCompare(b.itemId))
    .slice(0, limite)
    .map(({ ultima: _ultima, ...v }) => v)

  const possuidos = dados.volumes.filter((v) => v.estado !== 'desejo' && !v.varianteDe)
  const comprados = possuidos.filter((v) => noAno(v.dataAquisicao, ano)).length
  const lidosPelaPrimeiraVez = doAno.filter((l) => !l.releitura).length
  const naFilaAgora = possuidos.filter((v) => v.estado === 'comprado').length

  return {
    ano,
    vazio: doAno.length === 0,
    leituras: doAno.length,
    releituras: doAno.filter((l) => l.releitura).length,
    volumesDistintos: idsDistintos.length,
    porMes,
    mesMaisAtivo,
    porTipo,
    seriesIniciadas,
    seriesConcluidas,
    serieMaisLida,
    editoras: contar(nomesEditoras).slice(0, limite),
    tags: contar(nomesTags).slice(0, limite),
    mediaDasNotas,
    maiorSequencia: maiorSequenciaDeMeses(doAno.map((l) => mesDe(l.lidoEm))),
    compradosXLidos: { comprados, lidosPelaPrimeiraVez, naFilaAgora },
    emprestimos: {
      feitos: dados.emprestimos.filter((e) => noAno(e.emprestadoEm, ano)).length,
      devolvidos: dados.emprestimos.filter((e) => noAno(e.devolvidoEm, ano)).length,
      abertos: dados.emprestimos.filter((e) => !e.devolvidoEm).length,
    },
    top5,
    primeiraLeitura: doAno[0] ?? null,
    ultimaLeitura: doAno.at(-1) ?? null,
  }
}

// ---------------------------------------------------------------------------------------------
// Comparação com a média dos amigos (só com o que `ranking_amigos`, da 0023, já devolve)
// ---------------------------------------------------------------------------------------------

export type ComparacaoComAmigos = {
  /** Volumes lidos no ano que os amigos também avaliaram (e que você avaliou). */
  comparados: number
  acima: number
  abaixo: number
  iguais: number
  /** Média de (sua nota − média dos amigos); positivo = você nota mais alto que eles. */
  diferencaMedia: number
}

/** `minhasNotas`: itemId -> nota dos volumes lidos no ano. `linhas`: saída de `ranking_amigos` (minha_nota/meu_item_id/media). */
export function compararComAmigos(
  minhasNotas: Map<string, number>,
  linhas: { meuItemId: string | null; minhaNota: number | null; media: number }[]
): ComparacaoComAmigos | null {
  const vistos = new Set<string>()
  let acima = 0
  let abaixo = 0
  let iguais = 0
  let soma = 0
  for (const l of linhas) {
    if (!l.meuItemId || l.minhaNota === null || !minhasNotas.has(l.meuItemId) || vistos.has(l.meuItemId)) continue
    vistos.add(l.meuItemId)
    const dif = Math.round((l.minhaNota - l.media) * 100) / 100
    soma += dif
    if (dif > 0) acima++
    else if (dif < 0) abaixo++
    else iguais++
  }
  const comparados = acima + abaixo + iguais
  if (comparados === 0) return null
  return { comparados, acima, abaixo, iguais, diferencaMedia: Math.round((soma / comparados) * 100) / 100 }
}

// ---------------------------------------------------------------------------------------------
// Destaque discreto em dezembro/janeiro
// ---------------------------------------------------------------------------------------------

/** Ano candidato ao destaque: dezembro = o corrente, janeiro = o anterior, nos outros meses nenhum. `hoje` = AAAA-MM-DD. */
export function anoCandidatoAoDestaque(hoje: string): number | null {
  const mes = mesDe(hoje)
  return mes === 12 ? anoDe(hoje) : mes === 1 ? anoDe(hoje) - 1 : null
}

/** O candidato, só se houver leitura nele. */
export function anoEmDestaque(hoje: string, anosComDados: number[]): number | null {
  const alvo = anoCandidatoAoDestaque(hoje)
  return alvo !== null && anosComDados.includes(alvo) ? alvo : null
}

// ---------------------------------------------------------------------------------------------
// Carga (RLS devolve só as linhas da própria pessoa)
// ---------------------------------------------------------------------------------------------

type TagCrua = { tag: TagDoVolume | TagDoVolume[] | null }
type VolumeCru = {
  id: string
  titulo: string
  numero_volume: number | string | null
  tipo: TipoObra
  estado: EstadoItem
  variante_de: string | null
  nota: number | string | null
  capa_url: string | null
  data_aquisicao: string | null
  serie_id: string | null
  item_tags: TagCrua[] | null
  serie: { serie_tags: TagCrua[] | null } | { serie_tags: TagCrua[] | null }[] | null
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const um = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

function tagsDe(lista: TagCrua[] | null | undefined): TagDoVolume[] {
  return (lista ?? []).map((t) => um(t.tag)).filter((t): t is TagDoVolume => !!t)
}

export function volumeDaLinha(r: VolumeCru): VolumeParaEstatistica {
  const serie = um(r.serie)
  const tags = new Map<string, TagDoVolume>()
  for (const t of [...tagsDe(r.item_tags), ...tagsDe(serie?.serie_tags)]) tags.set(t.id, t)
  return {
    id: r.id,
    titulo: r.titulo,
    numeroVolume: num(r.numero_volume),
    tipo: r.tipo,
    estado: r.estado,
    varianteDe: r.variante_de,
    nota: num(r.nota),
    capaUrl: r.capa_url,
    dataAquisicao: r.data_aquisicao,
    serieId: r.serie_id,
    tags: [...tags.values()],
  }
}

export async function carregarDadosParaEstatisticas(supabase: Cliente): Promise<DadosParaEstatisticas> {
  const [volumes, series, leituras, emprestimos] = await Promise.all([
    lerTodasAsLinhas<VolumeCru>(
      (de, ate) =>
        supabase
          .from('itens')
          .select(
            'id, titulo, numero_volume, tipo, estado, variante_de, nota, capa_url, data_aquisicao, serie_id, item_tags(tag:tags(id, nome, tipo)), serie:series(serie_tags(tag:tags(id, nome, tipo)))'
          )
          .order('id')
          .range(de, ate) as unknown as PromiseLike<{ data: VolumeCru[] | null; error: { message: string } | null }>
    ),
    lerTodasAsLinhas<{ id: string; nome: string; total_volumes: number | null; em_publicacao: boolean | null }>(
      (de, ate) =>
        supabase.from('series').select('id, nome, total_volumes, em_publicacao').order('id').range(de, ate) as unknown as PromiseLike<{
          data: { id: string; nome: string; total_volumes: number | null; em_publicacao: boolean | null }[] | null
          error: { message: string } | null
        }>
    ),
    lerTodasAsLinhas<{ id: string; item_id: string; lido_em: string; criado_em: string }>(
      (de, ate) =>
        supabase.from('leituras').select('id, item_id, lido_em, criado_em').order('id').range(de, ate) as unknown as PromiseLike<{
          data: { id: string; item_id: string; lido_em: string; criado_em: string }[] | null
          error: { message: string } | null
        }>
    ),
    lerTodasAsLinhas<{ id: string; emprestado_em: string; devolvido_em: string | null }>(
      (de, ate) =>
        supabase.from('emprestimos').select('id, emprestado_em, devolvido_em').order('id').range(de, ate) as unknown as PromiseLike<{
          data: { id: string; emprestado_em: string; devolvido_em: string | null }[] | null
          error: { message: string } | null
        }>
    ),
  ])
  return {
    volumes: volumes.map(volumeDaLinha),
    series: series.map((s) => ({ id: s.id, nome: s.nome, totalVolumes: s.total_volumes, emPublicacao: s.em_publicacao !== false })),
    leituras: leituras.map((l) => ({ id: l.id, itemId: l.item_id, lidoEm: l.lido_em, criadoEm: l.criado_em })),
    emprestimos: emprestimos.map((e) => ({ emprestadoEm: e.emprestado_em, devolvidoEm: e.devolvido_em })),
  }
}

/**
 * Notas dos amigos para os volumes lidos no ano. Pagina `ranking_amigos` (até 500 por chamada) sem filtro de período:
 * o período da RPC olha a data de leitura do AMIGO, não a sua. Quem decide o que entra é `compararComAmigos`.
 * Sem amigos, sem escopo ou com erro da RPC: devolve null (a tela some com o bloco, não derruba a página).
 */
export async function carregarComparacaoComAmigos(supabase: Cliente, minhasNotas: Map<string, number>): Promise<ComparacaoComAmigos | null> {
  if (minhasNotas.size === 0) return null
  const linhas: { meuItemId: string | null; minhaNota: number | null; media: number }[] = []
  const POR_CHAMADA = 500
  const MAXIMO_DE_CHAMADAS = 6
  for (let i = 0; i < MAXIMO_DE_CHAMADAS; i++) {
    const { data, error } = await supabase.rpc('ranking_amigos', {
      p_tipo: null,
      p_desde: null,
      p_ate: null,
      p_ordem: 'recentes',
      p_so_nao_lidos: false,
      p_limite: POR_CHAMADA,
      p_offset: i * POR_CHAMADA,
    })
    if (error) return null
    const pagina = (data ?? []) as Record<string, unknown>[]
    for (const r of pagina) {
      linhas.push({
        meuItemId: typeof r.meu_item_id === 'string' ? r.meu_item_id : null,
        minhaNota: num(r.minha_nota),
        media: Number(r.media ?? 0),
      })
    }
    if (pagina.length < POR_CHAMADA) break
  }
  return compararComAmigos(minhasNotas, linhas)
}
