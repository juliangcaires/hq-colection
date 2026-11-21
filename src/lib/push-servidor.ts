import 'server-only'
import { after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/servico'
import { criarLimitador } from '@/lib/limite-taxa'
import { avisarPorPush, repositorioSupabase, vapidDoAmbiente, type CriterioDoAviso, type WebPush } from '@/lib/push'

/**
 * Dispara o Web Push depois que uma ação do usuário (curtir, comentar, pedir ou aceitar amizade) deu certo.
 * Roda no servidor, com a chave de serviço; sem as chaves VAPID (ou sem a de serviço) não faz nada.
 * NUNCA lança: um erro aqui é só registrado e a ação do usuário já foi concluída.
 *
 * As ações chamam `agendarPush`, que envia DEPOIS da resposta com `after()` do Next (a pessoa não espera o serviço de
 * push). A Netlify lista `next/after` como suportado (docs.netlify.com, "Next.js on Netlify"): o adaptador mantém a
 * função viva até o envio terminar. Se `after` não puder ser usado (fora de uma requisição, como nos testes), o envio
 * acontece na hora, como antes.
 */

// Curtir e descurtir em sequência apaga e recria o aviso; este freio evita um push por clique.
const limiteDePushPorAcao = criarLimitador({ max: 1, janelaMs: 10 * 60_000 })

export type OpcoesDoPush = {
  /** Distingue ações iguais no freio quando o critério não traz `refId` (ex.: o código do convite aceito). */
  freio?: string
}

export async function dispararPush(criterio: CriterioDoAviso, opcoes: OpcoesDoPush = {}): Promise<void> {
  try {
    const vapid = vapidDoAmbiente()
    if (!vapid) return
    const chave = [criterio.autorId, criterio.tipos.join('+'), criterio.itemId ?? '', criterio.refId ?? '', opcoes.freio ?? ''].join(':')
    if (!limiteDePushPorAcao.tentar(chave).ok) return
    const servico = createServiceClient()
    if (!servico) return
    const webpush = (await import('web-push')) as unknown as WebPush
    await avisarPorPush(criterio, { repo: repositorioSupabase(servico), webpush, vapid })
  } catch (e) {
    console.error('[push] falha ao disparar', e)
  }
}

/** Envia o push depois da resposta (`after`); se não der para agendar, envia aqui mesmo. Nunca lança. */
export async function agendarPush(criterio: CriterioDoAviso, opcoes: OpcoesDoPush = {}): Promise<void> {
  try {
    after(() => dispararPush(criterio, opcoes))
  } catch {
    await dispararPush(criterio, opcoes)
  }
}
