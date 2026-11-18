import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reimportar a planilha (R10) pode mudar título, número ou tipo de um item existente; nesses casos a `obra_chave`
 * precisa ser recalculada (o `completarChaves` só preenche chave vazia). Aqui só a decisão da action é testada:
 * o recálculo em si (`gravarChaveDoItem`) tem a sua própria cobertura.
 */
const U = '11111111-1111-1111-1111-111111111111'
const ITEM = '22222222-2222-2222-2222-222222222222'

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  gravarChaveDoItem: vi.fn(),
  classificarLinhas: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: U } } }) },
    from: (tabela: string) => ({
      update: (campos: unknown) => {
        mocks.update(tabela, campos)
        return { eq: () => ({ eq: async () => ({ error: null }) }) }
      },
    }),
  }),
}))
vi.mock('@/lib/obra-chaves', () => ({ gravarChaveDoItem: mocks.gravarChaveDoItem }))
vi.mock('@/lib/importar-itens', () => ({
  buscarSerieIdPorNome: vi.fn(),
  classificarLinhas: mocks.classificarLinhas,
  itemJaExiste: vi.fn(),
}))
vi.mock('@/lib/capa-catalogo', () => ({ aplicarCapaDeApi: vi.fn() }))
vi.mock('@/lib/capa-busca', () => ({ buscarCapaPorIsbn: vi.fn(), buscarCapaPorMemoria: vi.fn() }))

import { importarCsv } from '@/app/(app)/importar/actions'

const item = { id: ITEM, serie_id: null, capa_url: 'x.jpg' }
const atualizar = (campos: Record<string, unknown>) => ({
  linha: 2,
  tipo: 'atualizar' as const,
  item,
  plano: { campos, tagsNovas: [], mudancas: [], avisos: [] },
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('importar: recalcula a obra_chave quando o item muda', () => {
  it.each([
    ['titulo', { titulo: 'Berserk Deluxe' }],
    ['numero_volume', { numero_volume: 7 }],
    ['tipo', { tipo: 'hq' }],
  ])('%s alterado grava a chave do item', async (_nome, campos) => {
    mocks.classificarLinhas.mockResolvedValue([atualizar(campos)])
    const r = await importarCsv([{}], 2)
    expect(r.ok).toBe(true)
    expect(mocks.update).toHaveBeenCalledWith('itens', campos)
    expect(mocks.gravarChaveDoItem).toHaveBeenCalledTimes(1)
    expect(mocks.gravarChaveDoItem).toHaveBeenCalledWith(expect.anything(), ITEM)
    // a chave é recalculada depois da gravação dos campos
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.gravarChaveDoItem.mock.invocationCallOrder[0])
  })

  it('só nota/estado/lido_em alterados não mexem na chave', async () => {
    mocks.classificarLinhas.mockResolvedValue([atualizar({ nota: 4.5, estado: 'lido', lido_em: '2026-01-01', critica: 'bom' })])
    const r = await importarCsv([{}], 2)
    expect(r.ok).toBe(true)
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.gravarChaveDoItem).not.toHaveBeenCalled()
  })

  it('nada alterado: não atualiza e não toca na chave', async () => {
    mocks.classificarLinhas.mockResolvedValue([atualizar({})])
    const r = await importarCsv([{}], 2)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.itensSemMudanca).toBe(1)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.gravarChaveDoItem).not.toHaveBeenCalled()
  })
})
