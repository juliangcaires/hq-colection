/**
 * O navegador nunca lê a sessão (não existe client Supabase no front; tudo passa pelo servidor),
 * então os cookies podem ser HttpOnly: um XSS não consegue roubar o token.
 */
export const OPCOES_COOKIE = { httpOnly: true, secure: process.env.NODE_ENV === 'production' } as const
