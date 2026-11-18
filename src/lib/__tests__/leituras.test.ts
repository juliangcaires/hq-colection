import { describe, expect, it, vi } from 'vitest'
import { alvoDasLeituras, carregarLeituras, marcarReleituras, validarDataDeLeitura } from '@/lib/leituras'

describe('validarDataDeLeitura', () => {
  it('aceita hoje e o passado', () => {
    expect(validarDataDeLeitura('2026-11-17', '2026-11-17')).toBe('2026-11-17')
    expect(validarDataDeLeitura('2020-02-29', '2026-11-17')).toBe('2020-02-29')
  })
  it('recusa futuro, data impossível e formato errado', () => {
    expect(() => validarDataDeLeitura('2026-11-18', '2026-11-17')).toThrow('futuro')
    expect(() => validarDataDeLeitura('2026-02-30', '2026-11-17')).toThrow('Data inválida')
    expect(() => validarDataDeLeitura('17/11/2026', '2026-11-17')).toThrow()
    expect(() => validarDataDeLeitura('', '2026-11-17')).toThrow()
  })
})

describe('marcarReleituras', () => {
  it('a leitura mais antiga de cada volume é a original; as outras são releituras; sai da mais recente para a mais antiga', () => {
    const r = marcarReleituras([
      { id: 'a', item_id: 'x', lido_em: '2026-01-01' },
      { id: 'b', item_id: 'x', lido_em: '2026-08-01' },
      { id: 'c', item_id: 'y', lido_em: '2026-05-01' },
      { id: 'd', item_id: 'x', lido_em: '2026-03-01' },
    ])
    expect(r.map((l) => [l.id, l.releitura])).toEqual([['b', true], ['c', false], ['d', true], ['a', false]])
  })
  it('data igual desempata pelo registro e depois pelo id; um volume sozinho nunca é releitura', () => {
    const r = marcarReleituras([
      { id: 'b', item_id: 'x', lido_em: '2026-01-01', criado_em: '2026-01-01T10:00:00Z' },
      { id: 'a', item_id: 'x', lido_em: '2026-01-01', criado_em: '2026-01-01T09:00:00Z' },
      { id: 'z', item_id: 'y', lido_em: '2026-01-01' },
    ])
    expect(Object.fromEntries(r.map((l) => [l.id, l.releitura]))).toEqual({ a: false, b: true, z: false })
  })
  it('lista vazia', () => {
    expect(marcarReleituras([])).toEqual([])
  })
})

function clienteFalso(tabelas: Record<string, Record<string, unknown>[]>) {
  const from = vi.fn((tabela: string) => {
    let linhas = tabelas[tabela] ?? []
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => {
        linhas = linhas.filter((l) => l[col] === v)
        return q
      },
      maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: linhas, error: null }).then(ok),
    }
    return q
  })
  return { from } as never
}

describe('alvoDasLeituras', () => {
  const itens = [
    { id: 'p', estado: 'lido', variante_de: null },
    { id: 'v', estado: 'lido', variante_de: 'p' },
    { id: 'pd', estado: 'desejo', variante_de: null },
    { id: 'vd', estado: 'lido', variante_de: 'pd' },
    { id: 'n', estado: 'comprado', variante_de: null },
  ]
  it('item normal é o próprio alvo', async () => {
    expect(await alvoDasLeituras(clienteFalso({ itens }), 'p')).toEqual({ id: 'p', estado: 'lido' })
  })
  it('variante de principal que não é desejo usa o principal', async () => {
    expect(await alvoDasLeituras(clienteFalso({ itens }), 'v')).toEqual({ id: 'p', estado: 'lido' })
  })
  it('variante de principal em desejo guarda as próprias leituras', async () => {
    expect(await alvoDasLeituras(clienteFalso({ itens }), 'vd')).toEqual({ id: 'vd', estado: 'lido' })
  })
  it('item inexistente vira erro de negócio', async () => {
    await expect(alvoDasLeituras(clienteFalso({ itens }), 'nada')).rejects.toThrow('Item não encontrado')
  })
})

describe('carregarLeituras', () => {
  it('lê as do alvo (principal, para variante) e marca a releitura', async () => {
    const cliente = clienteFalso({
      itens: [
        { id: 'p', estado: 'lido', variante_de: null },
        { id: 'v', estado: 'lido', variante_de: 'p' },
      ],
      leituras: [
        { id: '1', item_id: 'p', lido_em: '2026-01-01', criado_em: '2026-01-01T00:00:00Z' },
        { id: '2', item_id: 'p', lido_em: '2026-09-01', criado_em: '2026-09-01T00:00:00Z' },
        { id: '3', item_id: 'outro', lido_em: '2026-02-01', criado_em: '2026-02-01T00:00:00Z' },
      ],
    })
    expect(await carregarLeituras(cliente, 'v')).toEqual([
      { id: '2', lidoEm: '2026-09-01', releitura: true },
      { id: '1', lidoEm: '2026-01-01', releitura: false },
    ])
  })
})
