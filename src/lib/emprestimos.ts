import { z } from 'zod'

/** Empréstimos: regras de data e entrada. Funções puras. */

export type SituacaoDoEmprestimo = 'devolvido' | 'atrasado' | 'vence_hoje' | 'em_dia' | 'sem_prazo'

/** `hoje` e as datas são `AAAA-MM-DD` (comparação de texto é cronológica nesse formato). */
export function situacaoDoEmprestimo(
  e: { devolver_ate: string | null; devolvido_em: string | null },
  hoje: string
): SituacaoDoEmprestimo {
  if (e.devolvido_em) return 'devolvido'
  if (!e.devolver_ate) return 'sem_prazo'
  if (e.devolver_ate < hoje) return 'atrasado'
  return e.devolver_ate === hoje ? 'vence_hoje' : 'em_dia'
}

/** Dias entre duas datas `AAAA-MM-DD` (b − a), em dias inteiros, ignorando horário de verão. */
export function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number)
  const [yb, mb, db] = b.split('-').map(Number)
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000)
}

export function textoDoPrazo(e: { devolver_ate: string | null; devolvido_em: string | null }, hoje: string): string {
  const s = situacaoDoEmprestimo(e, hoje)
  if (s === 'devolvido') return 'Devolvido'
  if (s === 'sem_prazo') return 'Sem prazo'
  const dias = diasEntre(hoje, e.devolver_ate!)
  if (s === 'vence_hoje') return 'Devolver hoje'
  if (s === 'atrasado') return `Atrasado há ${-dias} ${-dias === 1 ? 'dia' : 'dias'}`
  return `Devolver em ${dias} ${dias === 1 ? 'dia' : 'dias'}`
}

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')

export const emprestimoInputSchema = z
  .object({
    itemId: z.string().uuid(),
    paraQuem: z.string().trim().min(1, 'Diga para quem você emprestou').max(120, 'No máximo 120 caracteres'),
    emprestadoEm: data.nullish(),
    devolverAte: data.nullish(),
    observacao: z.string().trim().max(500, 'No máximo 500 caracteres').nullish(),
  })
  .refine((v) => !v.emprestadoEm || !v.devolverAte || v.devolverAte >= v.emprestadoEm, {
    message: 'O prazo de devolução não pode ser antes do empréstimo',
    path: ['devolverAte'],
  })

export type EmprestimoInput = z.input<typeof emprestimoInputSchema>
