import { describe, expect, it, vi } from 'vitest'
import {
  avisarPorPush,
  conteudoDoPush,
  JANELA_DO_PUSH_MS,
  preferenciaPermite,
  pushDisponivel,
  repositorioSupabase,
  vapidDoAmbiente,
  type AssinaturaPush,
  type ConfigVapid,
  type RepositorioPush,
  type WebPush,
} from '@/lib/push'
import { chaveParaBytes, ehAparelhoApple, situacaoDoPush } from '@/lib/push-cliente'
import { politicaDeSeguranca } from '@/lib/csp'
import { config } from '@/proxy'

const VAPID: ConfigVapid = { subject: 'mailto:dono@exemplo.com', publicKey: 'PUB', privateKey: 'PRIV' }
const silencio = () => {}

function repo({ assinaturas, ...over }: Partial<Omit<RepositorioPush, 'assinaturas'>> & { assinaturas?: AssinaturaPush[] } = {}) {
  const apagadas: string[] = []
  const r: RepositorioPush = {
    reivindicar: vi.fn(async () => [{ id: 'n1', user_id: 'dono', tipo: 'curtida' }]),
    preferencias: vi.fn(async () => null),
    assinaturas: vi.fn(async () => assinaturas ?? [{ id: 'a1', endpoint: 'https://push.exemplo/1', p256dh: 'k', auth: 's' }]),
    nomeDoAutor: vi.fn(async () => 'Beto'),
    apagarAssinatura: vi.fn(async (id: string) => void apagadas.push(id)),
    ...over,
  }
  return { r, apagadas }
}
const webpushOk = () => ({ sendNotification: vi.fn<WebPush['sendNotification']>(async () => ({ statusCode: 201 })) })
const criterio = { autorId: 'beto', tipos: ['curtida' as const], itemId: 'item' }

describe('vapidDoAmbiente / pushDisponivel', () => {
  const env = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: ' pub ', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:a@b.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' }
  it('exige as três variáveis e um subject https ou mailto; sem elas fica indisponível', () => {
    expect(vapidDoAmbiente(env)).toEqual({ subject: 'mailto:a@b.co', publicKey: 'pub', privateKey: 'priv' })
    expect(vapidDoAmbiente({ ...env, VAPID_PRIVATE_KEY: '' })).toBeNull()
    expect(vapidDoAmbiente({ ...env, NEXT_PUBLIC_VAPID_PUBLIC_KEY: undefined })).toBeNull()
    expect(vapidDoAmbiente({ ...env, VAPID_SUBJECT: 'http://inseguro' })).toBeNull()
    expect(vapidDoAmbiente({})).toBeNull()
  })
  it('o push também precisa da chave de serviço do Supabase (para ler as assinaturas)', () => {
    expect(pushDisponivel(env)).toBe(true)
    expect(pushDisponivel({ ...env, SUPABASE_SERVICE_ROLE_KEY: undefined })).toBe(false)
    expect(pushDisponivel({})).toBe(false)
  })
})

describe('preferenciaPermite', () => {
  it('padrão ligado; cada interruptor vale para o seu tipo; amizades cobrem pedido e aceite; tipo desconhecido não envia', () => {
    expect(preferenciaPermite(null, 'curtida')).toBe(true)
    expect(preferenciaPermite({ notif_push_curtidas: false }, 'curtida')).toBe(false)
    expect(preferenciaPermite({ notif_push_curtidas: false }, 'comentario')).toBe(true)
    expect(preferenciaPermite({ notif_push_comentarios: false }, 'comentario')).toBe(false)
    expect(preferenciaPermite({ notif_push_amizades: false }, 'amizade_pedido')).toBe(false)
    expect(preferenciaPermite({ notif_push_amizades: false }, 'amizade_aceita')).toBe(false)
    expect(preferenciaPermite(null, 'futuro')).toBe(false)
  })
})

describe('conteudoDoPush (sem spoiler)', () => {
  it('só quem fez e o quê; nunca crítica, nota ou texto', () => {
    expect(conteudoDoPush('curtida', 'Beto', 't')).toEqual({ titulo: 'Minha Coleção', corpo: 'Beto curtiu sua leitura', url: '/feed', tag: 't' })
    expect(conteudoDoPush('comentario', 'Ana', 't')?.corpo).toBe('Ana comentou na sua leitura')
    expect(conteudoDoPush('amizade_pedido', 'Carla', 't')).toMatchObject({ corpo: 'Carla enviou um pedido de amizade', url: '/amigos' })
    expect(conteudoDoPush('amizade_aceita', null, 't')?.corpo).toBe('Alguém aceitou seu pedido de amizade')
    expect(conteudoDoPush('futuro', 'X', 't')).toBeNull()
  })
})

describe('avisarPorPush', () => {
  it('curtir dispara o envio para TODAS as assinaturas do dono, com as chaves VAPID e o texto sem spoiler', async () => {
    const { r } = repo({ assinaturas: [
      { id: 'a1', endpoint: 'https://push.exemplo/1', p256dh: 'k1', auth: 's1' },
      { id: 'a2', endpoint: 'https://push.exemplo/2', p256dh: 'k2', auth: 's2' },
    ] })
    const wp = webpushOk()
    const n = await avisarPorPush(criterio, { repo: r, webpush: wp, vapid: VAPID, log: silencio })
    expect(n).toBe(2)
    expect(r.reivindicar).toHaveBeenCalledWith(criterio)
    expect(wp.sendNotification).toHaveBeenCalledTimes(2)
    const [assinatura, payload, opcoes] = wp.sendNotification.mock.calls[0]
    expect(assinatura).toEqual({ endpoint: 'https://push.exemplo/1', keys: { p256dh: 'k1', auth: 's1' } })
    expect(JSON.parse(payload)).toMatchObject({ corpo: 'Beto curtiu sua leitura', url: '/feed' })
    expect(opcoes).toMatchObject({ vapidDetails: VAPID, urgency: 'normal' })
  })

  it('respeita as preferências: tipo desligado não envia', async () => {
    const { r } = repo({ preferencias: vi.fn(async () => ({ notif_push_curtidas: false })) })
    const wp = webpushOk()
    expect(await avisarPorPush(criterio, { repo: r, webpush: wp, vapid: VAPID, log: silencio })).toBe(0)
    expect(wp.sendNotification).not.toHaveBeenCalled()
    // O interruptor de comentários não afeta curtidas.
    const c = repo({ preferencias: vi.fn(async () => ({ notif_push_comentarios: false })) })
    expect(await avisarPorPush(criterio, { repo: c.r, webpush: wp, vapid: VAPID, log: silencio })).toBe(1)
  })

  it('sem aviso novo (própria ação, repetida ou já enviada) ou sem assinaturas: não envia', async () => {
    const wp = webpushOk()
    const vazio = repo({ reivindicar: vi.fn(async () => []) })
    expect(await avisarPorPush(criterio, { repo: vazio.r, webpush: wp, vapid: VAPID, log: silencio })).toBe(0)
    const semAparelho = repo({ assinaturas: [] })
    expect(await avisarPorPush(criterio, { repo: semAparelho.r, webpush: wp, vapid: VAPID, log: silencio })).toBe(0)
    expect(wp.sendNotification).not.toHaveBeenCalled()
  })

  it('sem VAPID (ou sem repositório) nada acontece e nada é consultado', async () => {
    const { r } = repo()
    const wp = webpushOk()
    expect(await avisarPorPush(criterio, { repo: r, webpush: wp, vapid: null, log: silencio })).toBe(0)
    expect(await avisarPorPush(criterio, { repo: null, webpush: wp, vapid: VAPID, log: silencio })).toBe(0)
    expect(r.reivindicar).not.toHaveBeenCalled()
    expect(wp.sendNotification).not.toHaveBeenCalled()
  })

  it('erro de envio não derruba a ação: não lança, registra e segue nas outras assinaturas', async () => {
    const { r, apagadas } = repo({ assinaturas: [
      { id: 'a1', endpoint: 'https://push.exemplo/1', p256dh: 'k', auth: 's' },
      { id: 'a2', endpoint: 'https://push.exemplo/2', p256dh: 'k', auth: 's' },
    ] })
    const wp: WebPush = {
      sendNotification: vi.fn(async (a) => {
        if (a.endpoint.endsWith('/1')) throw Object.assign(new Error('boom'), { statusCode: 500 })
        return {}
      }),
    }
    const log = vi.fn()
    await expect(avisarPorPush(criterio, { repo: r, webpush: wp, vapid: VAPID, log })).resolves.toBe(1)
    expect(log).toHaveBeenCalled()
    expect(apagadas).toEqual([]) // 500 não apaga a assinatura
  })

  it('assinatura expirada (404/410) é removida; as outras ficam', async () => {
    const { r, apagadas } = repo({ assinaturas: [
      { id: 'velha404', endpoint: 'https://push.exemplo/1', p256dh: 'k', auth: 's' },
      { id: 'velha410', endpoint: 'https://push.exemplo/2', p256dh: 'k', auth: 's' },
      { id: 'boa', endpoint: 'https://push.exemplo/3', p256dh: 'k', auth: 's' },
    ] })
    const wp: WebPush = {
      sendNotification: vi.fn(async (a) => {
        if (a.endpoint.endsWith('/1')) throw Object.assign(new Error('gone'), { statusCode: 404 })
        if (a.endpoint.endsWith('/2')) throw Object.assign(new Error('gone'), { statusCode: 410 })
        return {}
      }),
    }
    expect(await avisarPorPush(criterio, { repo: r, webpush: wp, vapid: VAPID, log: silencio })).toBe(1)
    expect(apagadas.sort()).toEqual(['velha404', 'velha410'])
  })

  it('falha no banco (reivindicar/preferências) também não lança', async () => {
    const wp = webpushOk()
    const quebrado = repo({ reivindicar: vi.fn(async () => { throw new Error('db fora') }) })
    await expect(avisarPorPush(criterio, { repo: quebrado.r, webpush: wp, vapid: VAPID, log: silencio })).resolves.toBe(0)
    const prefsQuebradas = repo({ preferencias: vi.fn(async () => { throw new Error('db fora') }) })
    await expect(avisarPorPush(criterio, { repo: prefsQuebradas.r, webpush: wp, vapid: VAPID, log: silencio })).resolves.toBe(0)
    expect(wp.sendNotification).not.toHaveBeenCalled()
  })
})

describe('repositorioSupabase', () => {
  /** Cliente de mentira que grava a cadeia de chamadas e devolve `resposta` no fim (`await`). */
  function falso(resposta: { data: unknown; error: { message: string } | null }) {
    const chamadas: [string, unknown[]][] = []
    const cadeia: Record<string, unknown> = {}
    const proxy: unknown = new Proxy(cadeia, {
      get(_, nome: string) {
        if (nome === 'then') return (ok: (v: unknown) => void) => ok(resposta)
        return (...args: unknown[]) => {
          chamadas.push([nome, args])
          return proxy
        }
      },
    })
    return { cliente: { from: (t: string) => { chamadas.push(['from', [t]]); return proxy } } as never, chamadas }
  }

  it('reivindicar: atualiza só avisos do autor, do tipo, ainda não enviados e recentes (e filtra item/ref)', async () => {
    const { cliente, chamadas } = falso({ data: [{ id: 'n', user_id: 'u', tipo: 'curtida' }], error: null })
    const agora = Date.parse('2026-11-21T12:00:00Z')
    const r = repositorioSupabase(cliente, () => agora)
    const avisos = await r.reivindicar({ autorId: 'beto', tipos: ['curtida'], itemId: 'item', refId: 'ref' })
    expect(avisos).toHaveLength(1)
    const nomes = chamadas.map(([n]) => n)
    expect(nomes).toEqual(['from', 'update', 'eq', 'in', 'is', 'gte', 'eq', 'eq', 'select'])
    expect(chamadas[0][1]).toEqual(['notificacoes'])
    expect(chamadas[1][1]).toEqual([{ push_enviado_em: '2026-11-21T12:00:00.000Z' }])
    expect(chamadas[3][1]).toEqual(['tipo', ['curtida']])
    expect(chamadas[4][1]).toEqual(['push_enviado_em', null])
    expect(chamadas[5][1]).toEqual(['criado_em', new Date(agora - JANELA_DO_PUSH_MS).toISOString()])
  })
  it('erro do banco ao reivindicar lança (quem chama registra e não derruba a ação)', async () => {
    const { cliente } = falso({ data: null, error: { message: 'permission denied' } })
    await expect(repositorioSupabase(cliente).reivindicar({ autorId: 'a', tipos: ['curtida'] })).rejects.toThrow('permission denied')
  })
  it('nome do autor: nome de exibição, senão apelido, senão nulo', async () => {
    expect(await repositorioSupabase(falso({ data: { apelido: 'beto', nome_exibicao: 'Beto' }, error: null }).cliente).nomeDoAutor('x')).toBe('Beto')
    expect(await repositorioSupabase(falso({ data: { apelido: 'beto', nome_exibicao: null }, error: null }).cliente).nomeDoAutor('x')).toBe('beto')
    expect(await repositorioSupabase(falso({ data: null, error: null }).cliente).nomeDoAutor('x')).toBeNull()
  })
})

describe('push no navegador', () => {
  it('chaveParaBytes converte base64 de URL (com e sem preenchimento) em bytes', () => {
    expect(Array.from(chaveParaBytes('AQID'))).toEqual([1, 2, 3])
    expect(Array.from(chaveParaBytes('-_8'))).toEqual([251, 255])
    expect(Array.from(chaveParaBytes('AQI'))).toEqual([1, 2])
  })
  it('detecta iPhone, iPad e iPadOS que se diz Mac', () => {
    expect(ehAparelhoApple('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true)
    expect(ehAparelhoApple('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true)
    expect(ehAparelhoApple('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false)
    expect(ehAparelhoApple('Mozilla/5.0 (Linux; Android 14)')).toBe(false)
  })
  it('situação: indisponível > instalar no iPhone > sem suporte > bloqueado > pronto', () => {
    const ok = { disponivelNoServidor: true, apple: false, instalado: false, temServiceWorker: true, temPushManager: true, permissao: 'default' as const }
    expect(situacaoDoPush(ok)).toBe('pronto')
    expect(situacaoDoPush({ ...ok, disponivelNoServidor: false, apple: true })).toBe('indisponivel')
    expect(situacaoDoPush({ ...ok, apple: true, instalado: false })).toBe('instalar-no-iphone')
    expect(situacaoDoPush({ ...ok, apple: true, instalado: true })).toBe('pronto')
    expect(situacaoDoPush({ ...ok, temPushManager: false })).toBe('sem-suporte')
    expect(situacaoDoPush({ ...ok, permissao: 'indisponivel' })).toBe('sem-suporte')
    expect(situacaoDoPush({ ...ok, permissao: 'denied' })).toBe('bloqueado')
  })
})

describe('service worker e CSP', () => {
  it('a CSP libera só workers do próprio domínio', () => {
    expect(politicaDeSeguranca('N', { dev: false })).toContain("worker-src 'self'")
  })
  it('o /sw.js fica fora do proxy de login (o navegador o busca sozinho); as páginas continuam dentro', () => {
    const regex = new RegExp(`^${config.matcher[0]}$`)
    expect(regex.test('/sw.js')).toBe(false)
    expect(regex.test('/notificacoes')).toBe(true)
    expect(regex.test('/feed')).toBe(true)
  })
})
