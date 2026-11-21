'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { BellRing, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { desembrulhar } from '@/lib/resultado'
import { chaveParaBytes, ehAparelhoApple, situacaoDoPush, type SituacaoDoPush } from '@/lib/push-cliente'
import { definirPreferenciasPush, removerAssinaturaPush, salvarAssinaturaPush } from '@/app/(app)/notificacoes/push-actions'

type Preferencias = { curtidas: boolean; comentarios: boolean; amizades: boolean }

const TIPOS: { chave: keyof Preferencias; titulo: string; texto: string }[] = [
  { chave: 'curtidas', titulo: 'Curtidas', texto: 'Quando um amigo curtir uma leitura sua.' },
  { chave: 'comentarios', titulo: 'Comentários', texto: 'Quando um amigo comentar numa leitura sua.' },
  { chave: 'amizades', titulo: 'Amizades', texto: 'Pedido de amizade recebido e pedido aceito.' },
]

/**
 * Notificações no celular (Web Push). O sininho dentro do app funciona sempre; aqui se liga o aviso no aparelho.
 * `chavePublica` só vem quando o servidor tem as chaves VAPID e a de serviço: sem elas a seção avisa "indisponível".
 */
export function ConfiguracaoNotificacoes({ chavePublica, preferenciasIniciais }: { chavePublica: string | null; preferenciasIniciais: Preferencias }) {
  const [situacao, setSituacao] = useState<SituacaoDoPush | 'carregando'>('carregando')
  const [ativo, setAtivo] = useState(false)
  const [prefs, setPrefs] = useState(preferenciasIniciais)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    async function iniciar() {
      const temServiceWorker = 'serviceWorker' in navigator
      const temPushManager = 'PushManager' in window
      const permissao = 'Notification' in window ? Notification.permission : 'indisponivel'
      const instalado = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
      setSituacao(
        situacaoDoPush({
          disponivelNoServidor: chavePublica !== null,
          apple: ehAparelhoApple(navigator.userAgent, navigator.maxTouchPoints),
          instalado,
          temServiceWorker,
          temPushManager,
          permissao,
        })
      )
      if (temServiceWorker && temPushManager) {
        try {
          const registro = await navigator.serviceWorker.getRegistration('/')
          setAtivo(Boolean(registro && (await registro.pushManager.getSubscription())))
        } catch {
          setAtivo(false)
        }
      }
    }
    void iniciar()
  }, [chavePublica])

  function ativar() {
    if (!chavePublica) return
    startTransition(async () => {
      try {
        // A permissão tem de ser pedida num toque do usuário; por isso é a primeira coisa.
        const permissao = await Notification.requestPermission()
        if (permissao !== 'granted') {
          setSituacao(permissao === 'denied' ? 'bloqueado' : 'pronto')
          toast.error(permissao === 'denied' ? 'Notificações bloqueadas neste aparelho. Libere nas configurações do navegador.' : 'Permissão não concedida')
          return
        }
        await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
        const registro = await navigator.serviceWorker.ready
        const assinatura = (await registro.pushManager.getSubscription()) ?? (await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(chavePublica) }))
        const json = assinatura.toJSON()
        try {
          desembrulhar(await salvarAssinaturaPush({ endpoint: json.endpoint, keys: json.keys }))
        } catch (e) {
          // Sem gravar no servidor a assinatura não serve: desfaz aqui para o botão não mentir.
          await assinatura.unsubscribe().catch(() => {})
          throw e
        }
        setAtivo(true)
        toast.success('Notificações ativadas neste aparelho')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível ativar as notificações')
      }
    })
  }

  function desativar() {
    startTransition(async () => {
      try {
        const registro = await navigator.serviceWorker.getRegistration('/')
        const assinatura = await registro?.pushManager.getSubscription()
        if (assinatura) {
          const endpoint = assinatura.endpoint
          await assinatura.unsubscribe()
          desembrulhar(await removerAssinaturaPush(endpoint))
        }
        setAtivo(false)
        toast.success('Notificações desativadas neste aparelho')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível desativar')
      }
    })
  }

  function alterar(chave: keyof Preferencias, valor: boolean) {
    const anterior = prefs
    const novas = { ...prefs, [chave]: valor }
    setPrefs(novas)
    startTransition(async () => {
      try {
        desembrulhar(await definirPreferenciasPush(novas))
      } catch (e) {
        setPrefs(anterior)
        toast.error(e instanceof Error ? e.message : 'Não foi possível salvar')
      }
    })
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-[18px]">
      <h2 className="flex items-center gap-2 font-heading text-[19px] font-bold">
        <BellRing className="size-[18px] text-primary" aria-hidden /> Notificações
      </h2>
      <p className="text-sm text-muted-foreground">
        O sininho dentro do app avisa quando um amigo curte ou comenta uma leitura sua, pede amizade ou aceita o seu pedido. Aqui você também pode receber esses avisos no celular,
        mesmo com o app fechado. Os avisos não mostram crítica nem o texto do comentário.
      </p>
      <p className="flex gap-2 rounded-xl border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
        <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold text-foreground">iPhone e iPad:</strong> o aviso no celular só funciona com o app instalado na tela inicial (no Safari, Compartilhar → Adicionar à Tela de
          Início) e iOS 16.4 ou mais recente. Abra o app instalado para ativar aqui.
        </span>
      </p>

      {situacao === 'carregando' && <p className="text-sm text-muted-foreground">Verificando este aparelho…</p>}
      {situacao === 'indisponivel' && (
        <p role="status" className="rounded-xl border border-border bg-surface-2 p-3 text-sm text-foreground">
          Notificações no celular indisponíveis no momento (o servidor ainda não foi configurado para isso). O sininho do app continua funcionando.
        </p>
      )}
      {situacao === 'instalar-no-iphone' && (
        <p role="status" className="rounded-xl border border-border bg-surface-2 p-3 text-sm text-foreground">
          Instale o app na tela inicial para ativar os avisos neste aparelho.
        </p>
      )}
      {situacao === 'sem-suporte' && (
        <p role="status" className="rounded-xl border border-border bg-surface-2 p-3 text-sm text-foreground">
          Este navegador não oferece notificações no celular. Tente outro navegador ou o app instalado.
        </p>
      )}
      {situacao === 'bloqueado' && (
        <p role="status" className="rounded-xl border border-border bg-surface-2 p-3 text-sm text-foreground">
          As notificações estão bloqueadas neste aparelho. Libere nas configurações do navegador (ou do app instalado) e volte aqui.
        </p>
      )}

      {situacao === 'pronto' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {ativo ? (
              <Button variant="outline" onClick={desativar} disabled={isPending}>
                Desativar neste aparelho
              </Button>
            ) : (
              <Button onClick={ativar} disabled={isPending}>
                Ativar neste aparelho
              </Button>
            )}
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {ativo ? 'Ativas neste aparelho.' : 'Desligadas neste aparelho.'}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">Avisar por notificação quando:</p>
            {TIPOS.map((t) => (
              <label key={t.chave} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-2 p-3">
                <Checkbox className="mt-0.5" checked={prefs[t.chave]} disabled={isPending} onCheckedChange={(v) => alterar(t.chave, v === true)} />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{t.titulo}</span>
                  <span className="text-xs text-muted-foreground">{t.texto}</span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
