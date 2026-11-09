import { z } from 'zod'

/** Seções de uma coleção que podem ser mostradas a quem recebe o acesso (mesmos valores do banco: `escopo_valido`). */
export const SECOES_COMPARTILHAVEIS = [
  { valor: 'colecao', rotulo: 'Coleção', descricao: 'O que você tem: título, capa, série e número.' },
  { valor: 'series', rotulo: 'Séries', descricao: 'Cada série com quantos volumes você tem.' },
  { valor: 'lidos', rotulo: 'Lidos', descricao: 'O que você já leu e quando.' },
  { valor: 'notas_criticas', rotulo: 'Notas e críticas', descricao: 'Suas notas e críticas. Crítica marcada como privada nunca aparece.' },
  { valor: 'ranking', rotulo: 'Ranking', descricao: 'Seus lidos melhor avaliados (mostra a nota, não a crítica).' },
  { valor: 'desejos', rotulo: 'Lista de desejos', descricao: 'O que você quer comprar.' },
] as const

export type SecaoCompartilhavel = (typeof SECOES_COMPARTILHAVEIS)[number]['valor']

export const escopoSchema = z
  .array(z.enum(SECOES_COMPARTILHAVEIS.map((s) => s.valor) as [SecaoCompartilhavel, ...SecaoCompartilhavel[]]))
  .min(1, 'Escolha ao menos uma seção')
  .max(6)
  .transform((e) => Array.from(new Set(e)))

/** Apelido: minúsculas, números e "_", de 3 a 30 caracteres. Maiúsculas viram minúsculas. */
export const APELIDOS_RESERVADOS = ['convite', 'comparar', 'capa']

export const apelidoSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,30}$/, 'Use de 3 a 30 letras minúsculas, números ou "_"')
  .refine((a) => !APELIDOS_RESERVADOS.includes(a), 'Esse apelido é reservado. Escolha outro.')

export const nomeExibicaoSchema = z.string().trim().max(80, 'No máximo 80 caracteres')

/** Fixo no texto da tela: o que NUNCA sai do app, em nenhum escopo. */
export const NUNCA_COMPARTILHADO = 'Preço, loja e data de compra nunca aparecem para ninguém.'

/** Caminho público do link (a origem vem do navegador: `window.location.origin`). */
export function caminhoDoLink(token: string): string {
  return `/c/${token}`
}

/** Token do link: só o formato que o banco gera; qualquer outra coisa nem vai ao banco. */
export function tokenValido(token: string): boolean {
  return /^[A-Za-z0-9_-]{32,64}$/.test(token)
}
