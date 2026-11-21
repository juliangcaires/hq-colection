import { createServiceClient } from '@/lib/supabase/servico'
import { criarLimitador } from '@/lib/limite-taxa'
import { avisarPorPush, repositorioSupabase, vapidDoAmbiente, type CriterioDoAviso, type WebPush } from '@/lib/push'

/**
 * Dispara o Web Push depois que uma ação do usuário (curtir, comentar, pedir ou aceitar amizade) deu certo.
 * Roda no servidor, com a chave de serviço; sem as chaves VAPID (ou sem a de serviço) não faz nada.
 * NUNCA lança: um erro aqui é só registrado e a ação do usuário já foi concluída.
 */

// Curtir e descurtir em sequência apaga e recria o aviso; este freio evita um push por clique.
const limiteDePushPorAcao = criarLimitador({ max: 1, janelaMs: 10 * 60_000 })

export async function dispararPush(criterio: CriterioDoAviso): Promise<void> {
  try {
    const vapid = vapidDoAmbiente()
    if (!vapid) return
    const chave = [criterio.autorId, criterio.tipos.join('+'), criterio.itemId ?? '', criterio.refId ?? ''].join(':')
    if (!limiteDePushPorAcao.tentar(chave).ok) return
    const servico = createServiceClient()
    if (!servico) return
    const webpush = (await import('web-push')) as unknown as WebPush
    await avisarPorPush(criterio, { repo: repositorioSupabase(servico), webpush, vapid })
  } catch (e) {
    console.error('[push] falha ao disparar', e)
  }
}
