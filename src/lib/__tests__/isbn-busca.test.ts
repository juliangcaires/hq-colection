import { describe, expect, it, vi } from 'vitest'
import { buscarEdicaoPorIsbn, type CatalogoEdicoes, type EdicaoDados } from '@/lib/isbn-busca'

const ISBN = '9788545702870'

const BRASIL_OK = {
  isbn: ISBN,
  title: 'Hellboy - Vol. 1',
  subtitle: null,
  authors: ['Mike Mignola', 'John Byrne'],
  publisher: 'Mythos Editora',
  synopsis: 'O demônio mais famoso dos quadrinhos.',
  year: 2019,
  page_count: 128,
  subjects: ['Quadrinhos'],
  cover_url: 'http://covers.example/hellboy.jpg',
  provider: 'cbl',
}
const BRASIL_SEM_CAPA = { ...BRASIL_OK, cover_url: null, synopsis: null }
const GOOGLE_OK = {
  items: [
    {
      volumeInfo: {
        title: 'Hellboy Vol. 1',
        authors: ['Mike Mignola'],
        publisher: 'Mythos',
        publishedDate: '2019-05-01',
        description: '<p>Sinopse do <b>Google</b></p>',
        pageCount: 130,
        categories: ['Comics & Graphic Novels'],
        imageLinks: { thumbnail: 'http://books.google.com/capa.jpg' },
      },
    },
  ],
}

type Rota = { status: number; corpo?: unknown } | 'timeout' | 'rede'

/** fetch falso: roteia por domínio e guarda as chamadas. Nunca toca a rede. */
function fetchFalso(rotas: { brasil?: Rota; google?: Rota }) {
  const chamadas: string[] = []
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    chamadas.push(url)
    const rota = url.includes('brasilapi') ? rotas.brasil : url.includes('googleapis') ? rotas.google : undefined
    if (!rota) throw new Error(`chamada inesperada: ${url}`)
    if (rota === 'timeout') throw new DOMException('timeout', 'TimeoutError')
    if (rota === 'rede') throw new TypeError('fetch failed')
    return new Response(JSON.stringify(rota.corpo ?? {}), { status: rota.status })
  })
  return { fn: fn as unknown as typeof fetch, chamadas }
}

function catalogoFalso(existente: (EdicaoDados & { id: string }) | null = null) {
  const registrados: EdicaoDados[] = []
  const catalogo: CatalogoEdicoes = {
    buscar: async () => existente,
    registrar: async (e) => {
      registrados.push(e)
      return 'id-novo'
    },
  }
  return { catalogo, registrados }
}

describe('buscarEdicaoPorIsbn', () => {
  it('catálogo primeiro: não chama nenhuma API', async () => {
    const existente = { id: 'e1', isbn13: ISBN, titulo: 'Do catálogo', serie_nome: null, numero_volume: null, tipo: 'hq', editora: null, autores: [], ano: null, paginas: null, sinopse: null, capa_url_externa: null, origem: 'brasilapi' } as const
    const { catalogo, registrados } = catalogoFalso({ ...existente, autores: [] })
    const { fn, chamadas } = fetchFalso({})
    const r = await buscarEdicaoPorIsbn(ISBN, { catalogo, fetchFn: fn })
    expect(r).toMatchObject({ status: 'ok', fonte: 'catalogo', edicaoId: 'e1' })
    expect(chamadas).toHaveLength(0)
    expect(registrados).toHaveLength(0)
  })

  it('BrasilAPI achou: extrai série e número, completa a capa pelo Google e grava no catálogo', async () => {
    const { catalogo, registrados } = catalogoFalso()
    const { fn, chamadas } = fetchFalso({ brasil: { status: 200, corpo: BRASIL_SEM_CAPA }, google: { status: 200, corpo: GOOGLE_OK } })
    const r = await buscarEdicaoPorIsbn(ISBN, { catalogo, fetchFn: fn })
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.fonte).toBe('brasilapi')
    expect(r.edicao).toMatchObject({
      titulo: 'Hellboy - Vol. 1',
      serie_nome: 'Hellboy',
      numero_volume: 1,
      editora: 'Mythos Editora',
      autores: ['Mike Mignola', 'John Byrne'],
      ano: 2019,
      paginas: 128,
      tipo: 'hq',
      origem: 'brasilapi',
      capa_url_externa: 'https://books.google.com/capa.jpg',
      sinopse: 'Sinopse do Google',
    })
    expect(chamadas).toHaveLength(2)
    expect(registrados).toHaveLength(1)
    expect(r.edicaoId).toBe('id-novo')
  })

  it('BrasilAPI completa não precisa do Google', async () => {
    const { catalogo } = catalogoFalso()
    const { fn, chamadas } = fetchFalso({ brasil: { status: 200, corpo: BRASIL_OK } })
    const r = await buscarEdicaoPorIsbn(ISBN, { catalogo, fetchFn: fn })
    expect(r).toMatchObject({ status: 'ok', edicao: { capa_url_externa: 'https://covers.example/hellboy.jpg' } })
    expect(chamadas).toHaveLength(1)
  })

  it('BrasilAPI 404 cai no Google Books (origem google_books)', async () => {
    const { catalogo, registrados } = catalogoFalso()
    const { fn } = fetchFalso({ brasil: { status: 404, corpo: { message: 'ISBN não encontrado' } }, google: { status: 200, corpo: GOOGLE_OK } })
    const r = await buscarEdicaoPorIsbn(ISBN, { catalogo, fetchFn: fn })
    expect(r).toMatchObject({ status: 'ok', fonte: 'google_books', edicao: { origem: 'google_books', serie_nome: 'Hellboy', numero_volume: 1, ano: 2019 } })
    expect(registrados[0].origem).toBe('google_books')
  })

  it('ninguém encontra: nao_encontrado e nada é gravado', async () => {
    const { catalogo, registrados } = catalogoFalso()
    const { fn } = fetchFalso({ brasil: { status: 404 }, google: { status: 200, corpo: { totalItems: 0 } } })
    expect(await buscarEdicaoPorIsbn(ISBN, { catalogo, fetchFn: fn })).toEqual({ status: 'nao_encontrado' })
    expect(registrados).toHaveLength(0)
  })

  it('429 e 403 viram indisponível por quota; outra fonte ainda salva a busca', async () => {
    const { catalogo } = catalogoFalso()
    const a = fetchFalso({ brasil: { status: 429 }, google: { status: 403 } })
    expect(await buscarEdicaoPorIsbn(ISBN, { catalogo, fetchFn: a.fn })).toEqual({ status: 'indisponivel', motivo: 'quota' })
    const b = fetchFalso({ brasil: { status: 429 }, google: { status: 200, corpo: GOOGLE_OK } })
    expect(await buscarEdicaoPorIsbn(ISBN, { catalogo, fetchFn: b.fn })).toMatchObject({ status: 'ok', fonte: 'google_books' })
  })

  it('timeout, queda de rede e 500 viram indisponível por erro', async () => {
    const { catalogo } = catalogoFalso()
    for (const brasil of ['timeout', 'rede', { status: 500 }] as Rota[]) {
      const { fn } = fetchFalso({ brasil, google: { status: 503 } })
      expect(await buscarEdicaoPorIsbn(ISBN, { catalogo, fetchFn: fn })).toEqual({ status: 'indisponivel', motivo: 'erro' })
    }
  })

  it('respeita o limite do usuário antes de chamar APIs externas', async () => {
    const { catalogo } = catalogoFalso()
    const { fn, chamadas } = fetchFalso({})
    const r = await buscarEdicaoPorIsbn(ISBN, { catalogo, fetchFn: fn, permitirExterno: async () => false })
    expect(r).toEqual({ status: 'indisponivel', motivo: 'limite' })
    expect(chamadas).toHaveLength(0)
  })

  it('falha do catálogo não derruba a busca; falha ao gravar também não', async () => {
    const catalogo: CatalogoEdicoes = {
      buscar: async () => {
        throw new Error('banco fora')
      },
      registrar: async () => {
        throw new Error('sem permissão')
      },
    }
    const { fn } = fetchFalso({ brasil: { status: 200, corpo: BRASIL_OK } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await buscarEdicaoPorIsbn(ISBN, { catalogo, fetchFn: fn })
    expect(r).toMatchObject({ status: 'ok', edicaoId: null })
  })

  it('dados malformados e gigantes são sanitizados', async () => {
    const { catalogo } = catalogoFalso()
    const { fn } = fetchFalso({
      brasil: { status: 200, corpo: { title: 'X'.repeat(1000), authors: [1, null, 'Ok', ...Array(50).fill('A')], year: 'abc', page_count: -4, synopsis: 'S'.repeat(9000), cover_url: 'javascript:alert(1)', publisher: { a: 1 } } },
    })
    const r = await buscarEdicaoPorIsbn(ISBN, { catalogo, fetchFn: fn })
    if (r.status !== 'ok') throw new Error('esperava ok')
    expect(r.edicao.titulo).toHaveLength(300)
    expect(r.edicao.autores.length).toBeLessThanOrEqual(20)
    expect(r.edicao.ano).toBeNull()
    expect(r.edicao.paginas).toBeNull()
    expect(r.edicao.sinopse!.length).toBeLessThanOrEqual(4000)
    expect(r.edicao.capa_url_externa).toBeNull()
    expect(r.edicao.editora).toBeNull()
  })

  it('mangá é inferido pelos assuntos', async () => {
    const { catalogo } = catalogoFalso()
    const { fn } = fetchFalso({ brasil: { status: 200, corpo: { ...BRASIL_OK, subjects: ['Mangá', 'Ficção'], cover_url: 'https://x.com/a.jpg', synopsis: 'ok' } } })
    const r = await buscarEdicaoPorIsbn(ISBN, { catalogo, fetchFn: fn })
    expect(r).toMatchObject({ edicao: { tipo: 'manga' } })
  })
})
