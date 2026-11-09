import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: () => ({ rpc }) }))
const download = vi.fn()
let servicoDisponivel = true
vi.mock('@/lib/supabase/servico', () => ({
  createServiceClient: () => (servicoDisponivel ? { storage: { from: () => ({ download }) } } : null),
}))

import { GET } from '@/app/c/[token]/capa/[arquivo]/route'

const TOKEN = 'a1'.repeat(32)
const ARQ = '22222222-2222-4222-8222-222222222222-1700000000000.jpg'
const chamar = (token = TOKEN, arquivo = ARQ) => GET(new Request('http://x'), { params: Promise.resolve({ token, arquivo }) })

beforeEach(() => {
  rpc.mockReset()
  download.mockReset()
  servicoDisponivel = true
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('GET /c/[token]/capa/[arquivo]', () => {
  it('serve a capa quando o banco autoriza, com cache privado curto e noindex', async () => {
    rpc.mockResolvedValue({ data: `dono/${ARQ}`, error: null })
    download.mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null })
    const r = await chamar('b2'.repeat(32))
    expect(r.status).toBe(200)
    expect(r.headers.get('Content-Type')).toBe('image/jpeg')
    expect(r.headers.get('Cache-Control')).toBe('private, max-age=300')
    expect(r.headers.get('X-Robots-Tag')).toContain('noindex')
    expect(rpc).toHaveBeenCalledWith('link_capa', { p_token: 'b2'.repeat(32), p_arquivo: ARQ })
    expect(download).toHaveBeenCalledWith(`dono/${ARQ}`) // o caminho vem do banco, não da URL
  })

  it('token revogado/fora do escopo (banco devolve null): 404 e nenhum download', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect((await chamar('c3'.repeat(32))).status).toBe(404)
    expect(download).not.toHaveBeenCalled()
  })

  it('nome fora do padrão e token malformado: 404 sem nem consultar o banco', async () => {
    for (const [t, a] of [[TOKEN, '../segredo.jpg'], [TOKEN, 'x.jpg'], ['curto', ARQ], [TOKEN, `${ARQ}/../x`]] as const) {
      expect((await chamar(t, a)).status).toBe(404)
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('erro do banco: 404', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect((await chamar('d4'.repeat(32))).status).toBe(404)
  })

  it('sem chave de serviço configurada: 404 em vez de erro', async () => {
    servicoDisponivel = false
    rpc.mockResolvedValue({ data: `dono/${ARQ}`, error: null })
    expect((await chamar('e5'.repeat(32))).status).toBe(404)
  })

  it('limite por token: depois do teto responde 429, e outro token não é afetado', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const alvo = 'f6'.repeat(32)
    let ultimo = 200
    for (let i = 0; i < 905; i++) ultimo = (await chamar(alvo)).status
    expect(ultimo).toBe(429)
    expect((await chamar(alvo)).headers.get('Retry-After')).toBe('30')
    expect((await chamar('07'.repeat(32))).status).toBe(404)
  })
})
