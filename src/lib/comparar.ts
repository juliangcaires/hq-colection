import { normalizarParaChave } from '@/lib/texto'

/**
 * Comparação entre a minha coleção e a de um amigo. Funções puras.
 *
 * Duas séries são a mesma obra quando têm o mesmo nome normalizado + tipo, OU quando compartilham pelo
 * menos um livro com o mesmo ISBN (edição do catálogo da Fase 2) — assim "One Piece" e "One Piece (Panini)"
 * se encontram. Um volume é o mesmo quando tem o mesmo número dentro da série ou o mesmo ISBN.
 */

export type ItemParaComparar = {
  titulo: string
  serie_nome: string | null
  numero_volume: number | null
  tipo: 'hq' | 'manga'
  isbn13: string | null
  /** Nota do item lido; null se não avaliado ou se o dono não liberou notas. */
  nota: number | null
}

export type SerieParaComparar = { nome: string; tipo: 'hq' | 'manga'; nota: number | null }

export type LadoDaComparacao = { itens: ItemParaComparar[]; series: SerieParaComparar[] }

export type NotaDeVolume = { numero: number | null; titulo: string; minha: number; dele: number }

export type SerieEmComum = {
  meuNome: string
  nomeDele: string
  tipo: 'hq' | 'manga'
  meusNumeros: number[]
  numerosDele: number[]
  /** Volumes que ele tem e eu não (por número, descontando os que casam por ISBN). */
  eleTemEuNao: number[]
  /** Volumes que eu tenho e ele não. */
  euTenhoEleNao: number[]
  /** Volumes sem número (ou só com ISBN) que um lado tem e o outro não. */
  semNumeroEleTem: number
  semNumeroEuTenho: number
  notaMinha: number | null
  notaDele: number | null
  notasPorVolume: NotaDeVolume[]
}

export type Comparacao = {
  emComum: SerieEmComum[]
  soMinhas: string[]
  soDele: string[]
  /** Livros idênticos pelo ISBN (inclusive avulsos). */
  livrosIguais: number
}

const chaveDaSerie = (nome: string, tipo: string) => `${normalizarParaChave(nome)}|${tipo}`

/** Union-find mínimo sobre strings. */
class Grupos {
  private pai = new Map<string, string>()
  achar(x: string): string {
    if (!this.pai.has(x)) this.pai.set(x, x)
    let r = x
    while (this.pai.get(r) !== r) r = this.pai.get(r)!
    this.pai.set(x, r)
    return r
  }
  unir(a: string, b: string) {
    const ra = this.achar(a)
    const rb = this.achar(b)
    if (ra !== rb) this.pai.set(ra, rb)
  }
}

type Volume = { numero: number | null; isbn: string | null; titulo: string; nota: number | null }

function mesmoVolume(a: Volume, b: Volume): boolean {
  if (a.isbn && b.isbn && a.isbn === b.isbn) return true
  return a.numero !== null && b.numero !== null && a.numero === b.numero
}

const unicosOrdenados = (ns: (number | null)[]) => Array.from(new Set(ns.filter((n): n is number => n !== null))).sort((x, y) => x - y)

export function compararColecoes(eu: LadoDaComparacao, ele: LadoDaComparacao): Comparacao {
  const grupos = new Grupos()
  const meusPorSerie = new Map<string, { nome: string; tipo: 'hq' | 'manga'; volumes: Volume[] }>()
  const delesPorSerie = new Map<string, { nome: string; tipo: 'hq' | 'manga'; volumes: Volume[] }>()

  function agrupar(lado: LadoDaComparacao, destino: typeof meusPorSerie, prefixo: 'eu' | 'ele') {
    for (const i of lado.itens) {
      if (!i.serie_nome) continue
      const k = chaveDaSerie(i.serie_nome, i.tipo)
      if (!destino.has(k)) destino.set(k, { nome: i.serie_nome, tipo: i.tipo, volumes: [] })
      destino.get(k)!.volumes.push({ numero: i.numero_volume, isbn: i.isbn13, titulo: i.titulo, nota: i.nota })
      grupos.achar(`${prefixo}:${k}`)
    }
  }
  agrupar(eu, meusPorSerie, 'eu')
  agrupar(ele, delesPorSerie, 'ele')

  // Mesmo nome normalizado nos dois lados = mesma obra.
  for (const k of meusPorSerie.keys()) if (delesPorSerie.has(k)) grupos.unir(`eu:${k}`, `ele:${k}`)

  // Mesmo ISBN nos dois lados = mesma obra, mesmo que o nome da série seja diferente.
  const isbnDele = new Map<string, string>()
  for (const i of ele.itens) if (i.isbn13 && i.serie_nome) isbnDele.set(i.isbn13, chaveDaSerie(i.serie_nome, i.tipo))
  let livrosIguais = 0
  const isbnsDele = new Set(ele.itens.map((i) => i.isbn13).filter((x): x is string => Boolean(x)))
  const vistos = new Set<string>()
  for (const i of eu.itens) {
    if (!i.isbn13 || !isbnsDele.has(i.isbn13) || vistos.has(i.isbn13)) continue
    vistos.add(i.isbn13)
    livrosIguais++
    const dele = isbnDele.get(i.isbn13)
    if (i.serie_nome && dele) grupos.unir(`eu:${chaveDaSerie(i.serie_nome, i.tipo)}`, `ele:${dele}`)
  }

  // Séries por grupo.
  const porGrupo = new Map<string, { meus: string[]; deles: string[] }>()
  for (const k of meusPorSerie.keys()) {
    const g = grupos.achar(`eu:${k}`)
    if (!porGrupo.has(g)) porGrupo.set(g, { meus: [], deles: [] })
    porGrupo.get(g)!.meus.push(k)
  }
  for (const k of delesPorSerie.keys()) {
    const g = grupos.achar(`ele:${k}`)
    if (!porGrupo.has(g)) porGrupo.set(g, { meus: [], deles: [] })
    porGrupo.get(g)!.deles.push(k)
  }

  const notaDaSerie = (lado: LadoDaComparacao, nome: string, tipo: string) =>
    lado.series.find((s) => chaveDaSerie(s.nome, s.tipo) === chaveDaSerie(nome, tipo))?.nota ?? null

  const emComum: SerieEmComum[] = []
  const soMinhas: string[] = []
  const soDele: string[] = []

  for (const { meus, deles } of porGrupo.values()) {
    if (meus.length > 0 && deles.length > 0) {
      const mv = meus.flatMap((k) => meusPorSerie.get(k)!.volumes)
      const dv = deles.flatMap((k) => delesPorSerie.get(k)!.volumes)
      const m0 = meusPorSerie.get(meus[0])!
      const d0 = delesPorSerie.get(deles[0])!
      const eleTem = dv.filter((d) => !mv.some((m) => mesmoVolume(m, d)))
      const euTenho = mv.filter((m) => !dv.some((d) => mesmoVolume(m, d)))
      const notasPorVolume: NotaDeVolume[] = []
      for (const m of mv) {
        if (m.nota === null) continue
        const d = dv.find((x) => x.nota !== null && mesmoVolume(m, x))
        if (d) notasPorVolume.push({ numero: m.numero ?? d.numero, titulo: m.titulo, minha: m.nota, dele: d.nota! })
      }
      notasPorVolume.sort((a, b) => (a.numero ?? Infinity) - (b.numero ?? Infinity) || a.titulo.localeCompare(b.titulo, 'pt-BR'))
      emComum.push({
        meuNome: m0.nome,
        nomeDele: d0.nome,
        tipo: m0.tipo,
        meusNumeros: unicosOrdenados(mv.map((v) => v.numero)),
        numerosDele: unicosOrdenados(dv.map((v) => v.numero)),
        eleTemEuNao: unicosOrdenados(eleTem.map((v) => v.numero)),
        euTenhoEleNao: unicosOrdenados(euTenho.map((v) => v.numero)),
        semNumeroEleTem: eleTem.filter((v) => v.numero === null).length,
        semNumeroEuTenho: euTenho.filter((v) => v.numero === null).length,
        notaMinha: notaDaSerie(eu, m0.nome, m0.tipo),
        notaDele: notaDaSerie(ele, d0.nome, d0.tipo),
        notasPorVolume,
      })
    } else if (meus.length > 0) {
      soMinhas.push(...meus.map((k) => meusPorSerie.get(k)!.nome))
    } else {
      soDele.push(...deles.map((k) => delesPorSerie.get(k)!.nome))
    }
  }

  const ordem = (a: string, b: string) => a.localeCompare(b, 'pt-BR')
  emComum.sort((a, b) => ordem(a.meuNome, b.meuNome))
  soMinhas.sort(ordem)
  soDele.sort(ordem)
  return { emComum, soMinhas, soDele, livrosIguais }
}
