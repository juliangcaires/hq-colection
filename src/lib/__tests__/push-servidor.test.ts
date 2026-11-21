import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `agendarPush`: o envio sai DEPOIS da resposta (`after` do Next); se `after` não puder ser usado, sai na hora; e em
 * nenhum caso o push derruba a ação.
 */

const callbacks: (() => unknown)[] = []
let afterLanca = false
vi.mock('next/server', () => ({
  after: (cb: () => unknown) => {
    if (afterLanca) throw new Error('`after` was called outside a request scope')
    callbacks.push(cb)
  },
}))

const avisarPorPush = vi.fn(async () => 1)
vi.mock('@/lib/push', () => ({
  avisarPorPush: (...a: unknown[]) => (avisarPorPush as (...x: unknown[]) => Promise<number>)(...a),
  repositorioSupabase: () => ({}),
  vapidDoAmbiente: () => ({ subject: 'mailto:a@b.c', publicKey: 'PUB', privateKey: 'PRIV' }),
}))
vi.mock('@/lib/supabase/servico', () => ({ createServiceClient: () => ({}) }))
vi.mock('web-push', () => ({ sendNotification: vi.fn() }))

const AUTOR = '11111111-1111-4111-8111-111111111111'
let n = 0
/** Cada teste usa um item novo: o freio de 10 min é por autor + item e vive no módulo. */
const criterio = () => ({ autorId: AUTOR, tipos: ['curtida' as const], itemId: `item-${++n}` })

beforeEach(() => {
  callbacks.length = 0
  afterLanca = false
  avisarPorPush.mockClear()
  avisarPorPush.mockResolvedValue(1)
})

describe('agendarPush', () => {
  it('com `after`: devolve antes de enviar; o envio roda quando o Next executa o callback', async () => {
    const { agendarPush } = await import('@/lib/push-servidor')
    await agendarPush(criterio())
    expect(avisarPorPush).not.toHaveBeenCalled()
    expect(callbacks).toHaveLength(1)
    await callbacks[0]()
    expect(avisarPorPush).toHaveBeenCalledTimes(1)
  })

  it('sem `after` (fora de uma requisição): envia na hora, como antes', async () => {
    const { agendarPush } = await import('@/lib/push-servidor')
    afterLanca = true
    await agendarPush(criterio())
    expect(callbacks).toHaveLength(0)
    expect(avisarPorPush).toHaveBeenCalledTimes(1)
  })

  it('erro no envio, agendado ou na hora, não lança', async () => {
    const { agendarPush } = await import('@/lib/push-servidor')
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    avisarPorPush.mockRejectedValue(new Error('push fora do ar'))
    await expect(agendarPush(criterio())).resolves.toBeUndefined()
    await expect(callbacks[0]()).resolves.toBeUndefined()
    afterLanca = true
    await expect(agendarPush(criterio())).resolves.toBeUndefined()
    erro.mockRestore()
  })

  it('freio: a mesma ação duas vezes em 10 min envia 1; `freio` diferente (outro convite) envia de novo', async () => {
    const { dispararPush } = await import('@/lib/push-servidor')
    const c = { autorId: AUTOR, tipos: ['amizade_aceita' as const] }
    await dispararPush(c, { freio: 'convite-1' })
    await dispararPush(c, { freio: 'convite-1' })
    expect(avisarPorPush).toHaveBeenCalledTimes(1)
    await dispararPush(c, { freio: 'convite-2' })
    expect(avisarPorPush).toHaveBeenCalledTimes(2)
  })
})
