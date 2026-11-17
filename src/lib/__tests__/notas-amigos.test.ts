import { describe, expect, it, vi } from 'vitest'
import { carregarObraAmigos, carregarSerieAmigos } from '@/lib/notas-amigos'

describe('spoiler na crítica (0024)', () => {
  const linha = { item_id: 'a', apelido: 'beto', nota: 4, critica: 'o final', casou_por: 'isbn' }
  it('obra_amigos: o flag vem do banco; ausente ou nulo vira falso', async () => {
    const rpc = vi.fn(async () => ({ data: [{ ...linha, critica_spoiler: true }, { ...linha, item_id: 'b', critica_spoiler: false }, { ...linha, item_id: 'c' }, { ...linha, item_id: 'd', critica_spoiler: null }], error: null }))
    const r = await carregarObraAmigos({ rpc } as never, 'obra|1|hq', null)
    expect(r.map((a) => a.criticaSpoiler)).toEqual([true, false, false, false])
  })

  it('série não tem flag: a crítica da série continua como estava', async () => {
    const rpc = vi.fn(async () => ({ data: [{ apelido: 'beto', nota: 4, critica: 'boa' }], error: null }))
    const [r] = await carregarSerieAmigos({ rpc } as never, 'serie|hq')
    expect(r.criticaSpoiler).toBe(false)
  })
})
