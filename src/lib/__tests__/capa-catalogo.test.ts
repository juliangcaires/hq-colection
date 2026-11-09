import { beforeEach, describe, expect, it, vi } from 'vitest'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xda, 0, 4, 9, 9, 1, 2, 3, 0xff, 0xd9])
const baixar = vi.fn()
vi.mock('@/lib/capa-busca', () => ({ baixarImagemSegura: (...a: unknown[]) => baixar(...a) }))

import { aplicarCapaDeApi, aplicarFotoDoUsuario, chavesDoItem, usuarioContribuiCapas } from '@/lib/capa-catalogo'
import { sha256Hex } from '@/lib/imagem'

const ITEM_BD = {
  titulo: 'Berserk 3',
  numero_volume: '3',
  tipo: 'manga',
  isbn: '978-85-457-0287-0',
  serie: { nome: 'Berserk', serie_tags: [{ tags: { nome: 'Panini Brasil', tipo: 'editora' } }] },
  item_tags: [{ tags: { nome: 'Kentaro Miura', tipo: 'autor' } }],
}

function supabaseFalso(opts: { uploadErro?: string; rpcErro?: string; item?: unknown; contribui?: boolean } = {}) {
  const uploads: { bucket: string; caminho: string; upsert: unknown }[] = []
  const rpcs: { nome: string; args: Record<string, unknown> }[] = []
  const fake = {
    storage: {
      from: (bucket: string) => ({
        upload: async (caminho: string, _b: unknown, o: { upsert?: boolean }) => {
          uploads.push({ bucket, caminho, upsert: o.upsert })
          return { error: opts.uploadErro ? { message: opts.uploadErro } : null }
        },
      }),
    },
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args })
      return { data: 'capa-1', error: opts.rpcErro ? { message: opts.rpcErro } : null }
    },
    from: (tabela: string) => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.maybeSingle = async () => ({ data: tabela === 'perfis' ? { contribuir_capas: opts.contribui ?? false } : (opts.item === undefined ? ITEM_BD : opts.item), error: null })
      return b
    },
  }
  return { fake: fake as never, uploads, rpcs }
}

beforeEach(() => {
  baixar.mockReset()
})

describe('chavesDoItem', () => {
  it('monta ISBN-13, chave com editora normalizada e chave da série', async () => {
    const { fake } = supabaseFalso()
    expect(await chavesDoItem(fake, 'i1')).toEqual({
      isbn13: '9788545702870',
      chave: 'berserk|3|manga|panini brasil',
      serieChave: 'berserk|manga',
    })
  })
  it('item avulso usa o título e não tem chave de série', async () => {
    const { fake } = supabaseFalso({ item: { ...ITEM_BD, serie: null, isbn: null, numero_volume: null, item_tags: [] } })
    expect(await chavesDoItem(fake, 'i1')).toEqual({ isbn13: null, chave: 'berserk 3||manga|', serieChave: null })
  })
  it('item inexistente → null', async () => {
    const { fake } = supabaseFalso({ item: null })
    expect(await chavesDoItem(fake, 'i1')).toBeNull()
  })
})

describe('aplicarCapaDeApi', () => {
  it('publica com nome = hash, sem upsert, registra e devolve o caminho pub/', async () => {
    baixar.mockResolvedValue({ buffer: JPEG, mime: 'image/jpeg' })
    const { fake, uploads, rpcs } = supabaseFalso()
    const hash = await sha256Hex(JPEG)
    expect(await aplicarCapaDeApi(fake, 'i1', 'https://books.google.com/x')).toBe(`pub/${hash}.jpg`)
    expect(uploads).toEqual([{ bucket: 'capas-publicas', caminho: `${hash}.jpg`, upsert: false }])
    expect(rpcs[0]).toMatchObject({ nome: 'capa_catalogo_registrar', args: { p_isbn13: '9788545702870', p_origem: 'api', p_item: 'i1', p_hash: hash, p_caminho: `${hash}.jpg` } })
  })
  it('capa que já existe (mesmo hash) segue para o registro: o catálogo só soma o uso', async () => {
    baixar.mockResolvedValue({ buffer: JPEG, mime: 'image/jpeg' })
    const { fake, rpcs } = supabaseFalso({ uploadErro: 'The resource already exists' })
    expect(await aplicarCapaDeApi(fake, 'i1', 'https://books.google.com/x')).toMatch(/^pub\/[0-9a-f]{64}\.jpg$/)
    expect(rpcs).toHaveLength(1)
  })
  it('conteúdo que não é imagem não é publicado, mesmo com cabeçalho image/jpeg', async () => {
    baixar.mockResolvedValue({ buffer: new TextEncoder().encode('<html>'), mime: 'image/jpeg' })
    const { fake, uploads } = supabaseFalso()
    expect(await aplicarCapaDeApi(fake, 'i1', 'https://books.google.com/x')).toBeNull()
    expect(uploads).toHaveLength(0)
  })
  it('download recusado, upload com erro e registro com erro → null, sem lançar', async () => {
    baixar.mockResolvedValue(null)
    expect(await aplicarCapaDeApi(supabaseFalso().fake, 'i1', 'https://x')).toBeNull()
    baixar.mockResolvedValue({ buffer: JPEG, mime: 'image/jpeg' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await aplicarCapaDeApi(supabaseFalso({ uploadErro: 'bucket cheio' }).fake, 'i1', 'https://x')).toBeNull()
    expect(await aplicarCapaDeApi(supabaseFalso({ rpcErro: 'capa_invalida' }).fake, 'i1', 'https://x')).toBeNull()
  })

  it('falha inesperada no download vira null', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    baixar.mockRejectedValue(new Error('rede'))
    await expect(aplicarCapaDeApi(supabaseFalso().fake, 'i1', 'https://x')).resolves.toBeNull()
  })
})

describe('foto do usuário', () => {
  it('só o opt-in liga a contribuição (padrão desligado)', async () => {
    expect(await usuarioContribuiCapas(supabaseFalso().fake, 'u1')).toBe(false)
    expect(await usuarioContribuiCapas(supabaseFalso({ contribui: true }).fake, 'u1')).toBe(true)
  })
  it('publica sem os metadados e registra como "foto"', async () => {
    const comGps = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe1, 0, 13, ...Array.from('Exif\0\0GPS', (c) => c.charCodeAt(0)), 0, 0,
      0xff, 0xda, 0, 4, 9, 9, 1, 2, 0xff, 0xd9,
    ])
    const enviados: Uint8Array[] = []
    const { fake, rpcs } = supabaseFalso()
    ;(fake as { storage: { from: () => { upload: (c: string, b: Uint8Array) => Promise<unknown> } } }).storage.from = () => ({
      upload: async (_c: string, b: Uint8Array) => {
        enviados.push(b)
        return { error: null }
      },
    })
    expect(await aplicarFotoDoUsuario(fake, 'i1', comGps)).toMatch(/^pub\//)
    expect(Buffer.from(enviados[0]).includes(Buffer.from('GPS'))).toBe(false)
    expect(rpcs[0].args.p_origem).toBe('foto')
  })
  it('arquivo que não é imagem → null', async () => {
    expect(await aplicarFotoDoUsuario(supabaseFalso().fake, 'i1', new TextEncoder().encode('oi'))).toBeNull()
  })
})
