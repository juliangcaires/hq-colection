import type { SupabaseClient } from '@supabase/supabase-js'
import type { TipoNotificacao } from '@/lib/notificacoes'

/**
 * Web Push (migration 0033). Este arquivo é a lógica: quem recebe, o que o aviso diz e o que fazer com cada resposta
 * do serviço de push. O que fala com o mundo (banco, `web-push`) entra por parâmetro, para testar sem rede.
 *
 * Regras que valem aqui:
 *  - O texto NÃO revela spoiler: só quem fez e o que fez. Nunca crítica, nota ou texto do comentário.
 *  - Falha de push NUNCA derruba a ação do usuário: `avisarPorPush` não lança.
 *  - Assinatura que o serviço de push diz que morreu (404/410) é apagada.
 *  - Sem as chaves VAPID (`vapidDoAmbiente` devolve null) nada é enviado e o resto do app segue igual.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

export type ConfigVapid = { subject: string; publicKey: string; privateKey: string }

/** Chaves VAPID das variáveis de ambiente; null se faltar alguma (push indisponível). */
export function vapidDoAmbiente(env: Record<string, string | undefined> = process.env): ConfigVapid | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
  const privateKey = env.VAPID_PRIVATE_KEY?.trim()
  const subject = env.VAPID_SUBJECT?.trim()
  if (!publicKey || !privateKey || !subject) return null
  // O subject é uma URL ou um `mailto:` (exigência do VAPID); qualquer outra coisa o serviço de push recusaria.
  if (!/^(https:\/\/|mailto:)/.test(subject)) return null
  return { subject, publicKey, privateKey }
}

/** O envio precisa das chaves VAPID e da chave de serviço do Supabase (para ler as assinaturas do destinatário). */
export function pushDisponivel(env: Record<string, string | undefined> = process.env): boolean {
  return vapidDoAmbiente(env) !== null && Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim()) && Boolean(env.NEXT_PUBLIC_SUPABASE_URL?.trim())
}

export type PreferenciasPush = { notif_push_curtidas: boolean; notif_push_comentarios: boolean; notif_push_amizades: boolean }
/** Sem linha de preferências o padrão é tudo ligado (quem ativou o push quer receber). */
export const PREFERENCIAS_PADRAO: PreferenciasPush = { notif_push_curtidas: true, notif_push_comentarios: true, notif_push_amizades: true }

export function preferenciaPermite(prefs: Partial<PreferenciasPush> | null | undefined, tipo: string): boolean {
  const p = { ...PREFERENCIAS_PADRAO, ...(prefs ?? {}) }
  switch (tipo as TipoNotificacao) {
    case 'curtida':
      return p.notif_push_curtidas !== false
    case 'comentario':
      return p.notif_push_comentarios !== false
    case 'amizade_pedido':
    case 'amizade_aceita':
      return p.notif_push_amizades !== false
    default:
      return false // tipo que este app não conhece: não envia sem o dono do app decidir o texto e a preferência
  }
}

export type ConteudoDoPush = { titulo: string; corpo: string; url: string; tag: string }

/** Texto do push. Gênero neutro e nada além de quem fez e o quê. */
export function conteudoDoPush(tipo: string, nomeAutor: string | null, tag: string): ConteudoDoPush | null {
  const quem = nomeAutor?.trim() || 'Alguém'
  const titulo = 'Minha Coleção'
  switch (tipo as TipoNotificacao) {
    case 'curtida':
      return { titulo, corpo: `${quem} curtiu sua leitura`, url: '/feed', tag }
    case 'comentario':
      return { titulo, corpo: `${quem} comentou na sua leitura`, url: '/feed', tag }
    case 'amizade_pedido':
      return { titulo, corpo: `${quem} enviou um pedido de amizade`, url: '/amigos', tag }
    case 'amizade_aceita':
      return { titulo, corpo: `${quem} aceitou seu pedido de amizade`, url: '/amigos', tag }
    default:
      return null
  }
}

export type AssinaturaPush = { id: string; endpoint: string; p256dh: string; auth: string }

/** Acesso aos dados, no servidor (chave de serviço). Em teste entra um repositório em memória. */
export type RepositorioPush = {
  /** Marca como "push enviado" e devolve os avisos recentes do autor que ainda não tinham sido processados. */
  reivindicar(criterio: CriterioDoAviso): Promise<{ id: string; user_id: string; tipo: string }[]>
  preferencias(userId: string): Promise<Partial<PreferenciasPush> | null>
  assinaturas(userId: string): Promise<AssinaturaPush[]>
  nomeDoAutor(autorId: string): Promise<string | null>
  apagarAssinatura(id: string): Promise<void>
}

export type CriterioDoAviso = {
  autorId: string
  tipos: TipoNotificacao[]
  /** Curtida: o item curtido. */
  itemId?: string
  /** Comentário (o id do comentário) ou amizade (o id da amizade). */
  refId?: string
}

/** O pedaço do `web-push` que usamos (o pacote v4 não traz tipos). */
export type WebPush = {
  sendNotification(
    assinatura: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    opcoes: { vapidDetails: ConfigVapid; TTL: number; timeout: number; urgency: 'normal' }
  ): Promise<unknown>
}

/** Janela em que um aviso novo ainda vale para push (cobre a demora do clique até o RPC). */
export const JANELA_DO_PUSH_MS = 5 * 60_000
const TTL_SEGUNDOS = 24 * 60 * 60
const TIMEOUT_ENVIO_MS = 5_000

function statusDoErro(e: unknown): number | null {
  const s = (e as { statusCode?: unknown } | null)?.statusCode
  return typeof s === 'number' ? s : null
}

/**
 * Envia o push do(s) aviso(s) que acabaram de nascer da ação do `autorId`. Nunca lança e devolve quantos pushes
 * saíram (útil para teste e log).
 */
export async function avisarPorPush(
  criterio: CriterioDoAviso,
  deps: { repo: RepositorioPush | null; webpush: WebPush | null; vapid: ConfigVapid | null; log?: (msg: string, e?: unknown) => void }
): Promise<number> {
  const log = deps.log ?? ((msg, e) => console.error(`[push] ${msg}`, e ?? ''))
  try {
    if (!deps.vapid || !deps.repo || !deps.webpush) return 0
    const { repo, webpush, vapid } = deps
    const avisos = await repo.reivindicar(criterio)
    let enviados = 0
    for (const aviso of avisos) {
      try {
        const [prefs, assinaturas, nome] = await Promise.all([repo.preferencias(aviso.user_id), repo.assinaturas(aviso.user_id), repo.nomeDoAutor(criterio.autorId)])
        if (!preferenciaPermite(prefs, aviso.tipo) || assinaturas.length === 0) continue
        const conteudo = conteudoDoPush(aviso.tipo, nome, `${aviso.tipo}:${aviso.id}`)
        if (!conteudo) continue
        const payload = JSON.stringify(conteudo)
        await Promise.all(
          assinaturas.map(async (a) => {
            try {
              await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, payload, {
                vapidDetails: vapid,
                TTL: TTL_SEGUNDOS,
                timeout: TIMEOUT_ENVIO_MS,
                urgency: 'normal',
              })
              enviados++
            } catch (e) {
              const status = statusDoErro(e)
              if (status === 404 || status === 410) {
                // O aparelho desinstalou o app ou revogou a permissão: a assinatura não volta mais.
                await repo.apagarAssinatura(a.id).catch((err) => log('não consegui apagar a assinatura expirada', err))
              } else {
                log(`envio falhou (${status ?? 'sem status'})`, e)
              }
            }
          })
        )
      } catch (e) {
        log('falha ao preparar o aviso', e)
      }
    }
    return enviados
  } catch (e) {
    log('falha geral', e)
    return 0
  }
}

/** Repositório real, em cima do cliente com a chave de serviço. Só usar no servidor. */
export function repositorioSupabase(servico: Cliente, agora: () => number = Date.now): RepositorioPush {
  return {
    async reivindicar(c) {
      let q = servico
        .from('notificacoes')
        .update({ push_enviado_em: new Date(agora()).toISOString() })
        .eq('autor_id', c.autorId)
        .in('tipo', c.tipos)
        .is('push_enviado_em', null)
        .gte('criado_em', new Date(agora() - JANELA_DO_PUSH_MS).toISOString())
      if (c.itemId) q = q.eq('item_id', c.itemId)
      if (c.refId) q = q.eq('ref_id', c.refId)
      const { data, error } = await q.select('id, user_id, tipo')
      if (error) throw new Error(error.message)
      return (data ?? []) as { id: string; user_id: string; tipo: string }[]
    },
    async preferencias(userId) {
      const { data } = await servico.from('push_preferencias').select('notif_push_curtidas, notif_push_comentarios, notif_push_amizades').eq('user_id', userId).maybeSingle()
      return (data as Partial<PreferenciasPush> | null) ?? null
    },
    async assinaturas(userId) {
      const { data, error } = await servico.from('push_assinaturas').select('id, endpoint, p256dh, auth').eq('user_id', userId)
      if (error) throw new Error(error.message)
      return (data ?? []) as AssinaturaPush[]
    },
    async nomeDoAutor(autorId) {
      const { data } = await servico.from('perfis').select('apelido, nome_exibicao').eq('user_id', autorId).maybeSingle()
      const p = data as { apelido: string | null; nome_exibicao: string | null } | null
      return p?.nome_exibicao?.trim() || p?.apelido?.trim() || null
    },
    async apagarAssinatura(id) {
      const { error } = await servico.from('push_assinaturas').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
  }
}
