/**
 * Data de hoje como `YYYY-MM-DD` no fuso pedido (padrão: o do ambiente).
 *
 * `new Date().toISOString().slice(0, 10)` devolve a data em UTC, que no Brasil já é
 * "amanhã" a partir das 21h. No servidor passe o fuso do app; no navegador, nada.
 */
export function hojeIso(timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
}

/** Fuso usado quando o servidor precisa decidir "hoje" sem a data vinda do usuário. */
export const FUSO_DO_APP = 'America/Sao_Paulo'
