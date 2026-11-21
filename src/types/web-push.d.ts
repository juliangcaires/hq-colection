/** O pacote `web-push` v4 (ESM) não traz tipos; só declaramos o que o app usa (veja `WebPush` em `src/lib/push.ts`). */
declare module 'web-push' {
  export function sendNotification(
    assinatura: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    opcoes: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number; timeout: number; urgency: 'normal' }
  ): Promise<unknown>
}
