/**
 * Textos fixos para a tela de login/cadastro.
 *
 * A URL carrega só um CÓDIGO (`?erro=credenciais`), nunca o texto: antes `?error=` era escrito
 * na tela como veio, e qualquer link podia exibir uma mensagem falsa na página de login.
 * Também não repassamos `error.message` do Supabase, que distingue "e-mail não existe" de
 * "senha errada" (enumeração de contas).
 */
export const ERROS_AUTH = {
  credenciais: 'E-mail ou senha incorretos.',
  dados: 'Informe um e-mail válido e uma senha de 8 a 72 caracteres.',
  'senha-fraca': 'Escolha uma senha mais forte (mínimo 8 caracteres).',
  limite: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  cadastro: 'Não foi possível criar a conta. Confira os dados ou tente entrar.',
  generico: 'Algo deu errado. Tente novamente.',
} as const

export const AVISOS_AUTH = {
  'conta-criada': 'Conta criada. Verifique seu e-mail se a confirmação estiver ativada.',
} as const

export type CodigoErroAuth = keyof typeof ERROS_AUTH

/** Converte o erro do Supabase em um código, sem vazar o motivo exato. */
export function codigoDoErroAuth(error: { code?: string; status?: number }, tela: 'login' | 'cadastro'): CodigoErroAuth {
  if (error.code === 'weak_password') return 'senha-fraca'
  if (error.status === 429 || error.code?.includes('rate_limit')) return 'limite'
  if (tela === 'login') return error.status && error.status >= 500 ? 'generico' : 'credenciais'
  return error.status && error.status >= 500 ? 'generico' : 'cadastro'
}
