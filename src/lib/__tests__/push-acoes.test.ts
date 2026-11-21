import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * As ações do servidor de verdade (curtir, comentar, pedir e aceitar amizade) com o banco e o `web-push` de mentira:
 * o RPC dá certo, o push sai para as assinaturas do dono respeitando as preferências, e nenhuma falha de push derruba a ação.
 */

const AUTOR = '11111111-1111-4111-8111-111111111111'
const DONO = '22222222-2222-4222-8222-222222222222'
const ITEM = '33333333-3333-4333-8333-333333333333'
const COMENTARIO = '44444444-4444-4444-8444-444444444444'
const AMIZADE = '55555555-5555-4555-8555-555555555555'

type Linha = Record<string, unknown>
let tabelas: Record<string, Linha[]>
const rpcs: { nome: string; args: unknown }[] = []
let retornoDoRpc: Record<string, unknown> = {}
let erroDoRpc: Record<string, string> = {}

/** Banco em memória com o mínimo do query builder que o repositório usa. */
function servicoFalso() {
  return {
    from(tabela: string) {
      let op: 'select' | 'update' | 'delete' = 'select'
      let patch: Linha = {}
      const filtros: ((r: Linha) => boolean)[] = []
      const b = {
        update(p: Linha) { op = 'update'; patch = p; return b },
        delete() { op = 'delete'; return b },
        select() { return b },
        eq(c: string, v: unknown) { filtros.push((r) => r[c] === v); return b },
        in(c: string, vs: unknown[]) { filtros.push((r) => vs.includes(r[c])); return b },
        is(c: string, v: unknown) { filtros.push((r) => (r[c] ?? null) === v); return b },
        gte(c: string, v: string) { filtros.push((r) => String(r[c]) >= v); return b },
        maybeSingle() { return Promise.resolve({ data: executar()[0] ?? null, error: null }) },
        then(ok: (v: unknown) => void) { ok({ data: executar(), error: null }) },
      }
      function executar(): Linha[] {
        const linhas = tabelas[tabela] ?? []
        const achadas = linhas.filter((r) => filtros.every((f) => f(r)))
        if (op === 'update') achadas.forEach((r) => Object.assign(r, patch))
        if (op === 'delete') tabelas[tabela] = linhas.filter((r) => !achadas.includes(r))
        return achadas
      }
      return b
    },
  }
}

const sendNotification = vi.fn()
vi.mock('web-push', () => ({ sendNotification: (...a: unknown[]) => sendNotification(...a) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/servico', () => ({ createServiceClient: () => servicoFalso() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: AUTOR } } }) },
    rpc: async (nome: string, args: unknown) => {
      rpcs.push({ nome, args })
      if (erroDoRpc[nome]) return { data: null, error: { message: erroDoRpc[nome] } }
      return { data: retornoDoRpc[nome] ?? null, error: null }
    },
  }),
}))

const agoraIso = () => new Date().toISOString()
const assinatura = (id: string, user = DONO) => ({ id, user_id: user, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: 'k', auth: 's' })

// A 1ª importação das ações (next/server, zod, supabase...) é lenta quando o vitest roda tudo em paralelo; fora do tempo do teste.
beforeAll(async () => {
  await import('@/app/(app)/feed/actions')
  await import('@/app/(app)/amigos/actions')
}, 60_000)

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'PUB')
  vi.stubEnv('VAPID_PRIVATE_KEY', 'PRIV')
  vi.stubEnv('VAPID_SUBJECT', 'mailto:dono@exemplo.com')
  sendNotification.mockReset()
  sendNotification.mockResolvedValue({})
  rpcs.length = 0
  retornoDoRpc = {}
  erroDoRpc = {}
  tabelas = {
    perfis: [{ user_id: AUTOR, apelido: 'beto', nome_exibicao: 'Beto' }],
    push_assinaturas: [assinatura('a1'), assinatura('a2')],
    push_preferencias: [],
    notificacoes: [],
  }
})
afterEach(() => vi.unstubAllEnvs())

describe('curtir (ação do feed)', () => {
  it('o aviso criado pelo banco vira push para as assinaturas do dono; o mesmo aviso não sai duas vezes', async () => {
    const { alternarCurtida } = await import('@/app/(app)/feed/actions')
    tabelas.notificacoes = [{ id: 'n1', user_id: DONO, tipo: 'curtida', autor_id: AUTOR, item_id: ITEM, ref_id: null, criado_em: agoraIso(), push_enviado_em: null }]
    expect(await alternarCurtida(ITEM, true)).toEqual({ ok: true, data: undefined })
    expect(rpcs[0]).toEqual({ nome: 'feed_curtir', args: { p_item: ITEM } })
    expect(sendNotification).toHaveBeenCalledTimes(2)
    const [sub, payload, opcoes] = sendNotification.mock.calls[0]
    expect(sub.endpoint).toMatch(/^https:\/\/fcm\.googleapis\.com\/fcm\/send\//)
    expect(JSON.parse(payload)).toMatchObject({ corpo: 'Beto curtiu sua leitura', url: '/feed' })
    expect(opcoes.vapidDetails).toEqual({ subject: 'mailto:dono@exemplo.com', publicKey: 'PUB', privateKey: 'PRIV' })
    expect(tabelas.notificacoes[0].push_enviado_em).toBeTruthy()
    // Curtir de novo (aviso já processado): nenhum push novo.
    sendNotification.mockClear()
    await alternarCurtida(ITEM, true)
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('descurtir não envia; a própria curtida (sem aviso no banco) não envia', async () => {
    const { alternarCurtida } = await import('@/app/(app)/feed/actions')
    const outro = '66666666-6666-4666-8666-666666666666'
    tabelas.notificacoes = [{ id: 'n1', user_id: DONO, tipo: 'curtida', autor_id: AUTOR, item_id: ITEM, ref_id: null, criado_em: agoraIso(), push_enviado_em: null }]
    await alternarCurtida(ITEM, false)
    expect(sendNotification).not.toHaveBeenCalled()
    tabelas.notificacoes = []
    await alternarCurtida(outro, true)
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('erro de envio (e erro de banco no push) não derruba a ação; assinatura expirada é apagada', async () => {
    const { alternarCurtida } = await import('@/app/(app)/feed/actions')
    const item = '77777777-7777-4777-8777-777777777777'
    tabelas.notificacoes = [{ id: 'n1', user_id: DONO, tipo: 'curtida', autor_id: AUTOR, item_id: item, ref_id: null, criado_em: agoraIso(), push_enviado_em: null }]
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith('/a1')) throw Object.assign(new Error('gone'), { statusCode: 410 })
      throw Object.assign(new Error('boom'), { statusCode: 500 })
    })
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await alternarCurtida(item, true)).toEqual({ ok: true, data: undefined })
    expect(tabelas.push_assinaturas.map((a) => a.id)).toEqual(['a2'])
    erro.mockRestore()
  })

  it('RPC que falha continua falhando a ação e não envia push', async () => {
    const { alternarCurtida } = await import('@/app/(app)/feed/actions')
    erroDoRpc.feed_curtir = 'item_nao_encontrado'
    const r = await alternarCurtida('88888888-8888-4888-8888-888888888888', true)
    expect(r).toEqual({ ok: false, erro: 'Item não encontrado' })
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('sem as chaves VAPID a curtida funciona e nada é enviado nem consultado', async () => {
    const { alternarCurtida } = await import('@/app/(app)/feed/actions')
    vi.stubEnv('VAPID_PRIVATE_KEY', '')
    const item = '99999999-9999-4999-8999-999999999999'
    tabelas.notificacoes = [{ id: 'n1', user_id: DONO, tipo: 'curtida', autor_id: AUTOR, item_id: item, ref_id: null, criado_em: agoraIso(), push_enviado_em: null }]
    expect(await alternarCurtida(item, true)).toEqual({ ok: true, data: undefined })
    expect(sendNotification).not.toHaveBeenCalled()
    expect(tabelas.notificacoes[0].push_enviado_em).toBeNull()
  })

  it('preferência de curtidas desligada: o aviso é processado mas não sai push', async () => {
    const { alternarCurtida } = await import('@/app/(app)/feed/actions')
    const item = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    tabelas.push_preferencias = [{ user_id: DONO, notif_push_curtidas: false, notif_push_comentarios: true, notif_push_amizades: true }]
    tabelas.notificacoes = [{ id: 'n1', user_id: DONO, tipo: 'curtida', autor_id: AUTOR, item_id: item, ref_id: null, criado_em: agoraIso(), push_enviado_em: null }]
    await alternarCurtida(item, true)
    expect(sendNotification).not.toHaveBeenCalled()
  })
})

describe('comentar (ação do feed)', () => {
  it('o push do comentário sai pelo id que o RPC devolveu, sem o texto do comentário', async () => {
    const { comentar } = await import('@/app/(app)/feed/actions')
    retornoDoRpc.feed_comentar = COMENTARIO
    tabelas.notificacoes = [
      { id: 'n1', user_id: DONO, tipo: 'comentario', autor_id: AUTOR, item_id: ITEM, ref_id: COMENTARIO, criado_em: agoraIso(), push_enviado_em: null },
      { id: 'n2', user_id: DONO, tipo: 'comentario', autor_id: AUTOR, item_id: ITEM, ref_id: 'outro-comentario', criado_em: agoraIso(), push_enviado_em: null },
    ]
    expect(await comentar(ITEM, 'O final é surpreendente!')).toEqual({ ok: true, data: undefined })
    expect(sendNotification).toHaveBeenCalledTimes(2)
    const payload = String(sendNotification.mock.calls[0][1])
    expect(JSON.parse(payload).corpo).toBe('Beto comentou na sua leitura')
    expect(payload).not.toContain('final')
    expect(tabelas.notificacoes[1].push_enviado_em).toBeNull() // só o comentário desta ação
  })
})

describe('amizade (ações de Amigos)', () => {
  it('pedir amizade avisa o destinatário; aceitar avisa quem pediu', async () => {
    const { solicitarAmizade, responderAmizade } = await import('@/app/(app)/amigos/actions')
    retornoDoRpc.amizade_solicitar = AMIZADE
    tabelas.notificacoes = [{ id: 'n1', user_id: DONO, tipo: 'amizade_pedido', autor_id: AUTOR, item_id: null, ref_id: AMIZADE, criado_em: agoraIso(), push_enviado_em: null }]
    expect(await solicitarAmizade('dono')).toEqual({ ok: true, data: undefined })
    expect(sendNotification).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(sendNotification.mock.calls[0][1]))).toMatchObject({ corpo: 'Beto enviou um pedido de amizade', url: '/amigos' })

    sendNotification.mockClear()
    const outraAmizade = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    tabelas.notificacoes = [{ id: 'n2', user_id: DONO, tipo: 'amizade_aceita', autor_id: AUTOR, item_id: null, ref_id: outraAmizade, criado_em: agoraIso(), push_enviado_em: null }]
    expect(await responderAmizade(outraAmizade, true)).toEqual({ ok: true, data: undefined })
    expect(sendNotification).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(sendNotification.mock.calls[0][1])).corpo).toBe('Beto aceitou seu pedido de amizade')
  })

  it('recusar não envia push', async () => {
    const { responderAmizade } = await import('@/app/(app)/amigos/actions')
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    tabelas.notificacoes = [{ id: 'n3', user_id: DONO, tipo: 'amizade_aceita', autor_id: AUTOR, item_id: null, ref_id: id, criado_em: agoraIso(), push_enviado_em: null }]
    await responderAmizade(id, false)
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('aceitar convite avisa quem o gerou', async () => {
    const { aceitarConvite } = await import('@/app/(app)/amigos/actions')
    retornoDoRpc.convite_aceitar = 'dono'
    tabelas.notificacoes = [{ id: 'n4', user_id: DONO, tipo: 'amizade_aceita', autor_id: AUTOR, item_id: null, ref_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', criado_em: agoraIso(), push_enviado_em: null }]
    expect(await aceitarConvite('a'.repeat(32))).toEqual({ ok: true, data: 'dono' })
    expect(sendNotification).toHaveBeenCalledTimes(2)
  })

  it('freio do convite: o 2º convite aceito em 10 min também avisa (o código entra na chave); o mesmo convite não avisa duas vezes', async () => {
    const { aceitarConvite } = await import('@/app/(app)/amigos/actions')
    retornoDoRpc.convite_aceitar = 'dono'
    const aviso = (id: string) => ({ id, user_id: DONO, tipo: 'amizade_aceita', autor_id: AUTOR, item_id: null, ref_id: id, criado_em: agoraIso(), push_enviado_em: null })
    tabelas.notificacoes = [aviso('e1111111-1111-4111-8111-111111111111')]
    await aceitarConvite('b'.repeat(32))
    expect(sendNotification).toHaveBeenCalledTimes(2)
    // Outro convite (outro código) logo depois: sai push.
    sendNotification.mockClear()
    tabelas.notificacoes = [aviso('e2222222-2222-4222-8222-222222222222')]
    await aceitarConvite('c'.repeat(32))
    expect(sendNotification).toHaveBeenCalledTimes(2)
    // O mesmo código de novo dentro dos 10 min: freado.
    sendNotification.mockClear()
    tabelas.notificacoes = [aviso('e3333333-3333-4333-8333-333333333333')]
    await aceitarConvite('c'.repeat(32))
    expect(sendNotification).not.toHaveBeenCalled()
  })
})
