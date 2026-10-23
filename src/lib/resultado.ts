/**
 * Retorno das Server Actions de escrita.
 *
 * Em produção o Next NÃO envia ao navegador a mensagem de um erro lançado por
 * Server Action (só um `digest`), então regra de negócio como "esta série já tem
 * o #3" nunca chegaria ao toast. Erros esperados voltam como valor.
 */
export type Resultado<T> = { ok: true; data: T } | { ok: false; erro: string }

/** Erro esperado, com mensagem pensada para o usuário. */
export class ErroDeNegocio extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroDeNegocio'
  }
}

/** No cliente: devolve o dado ou lança com a mensagem, para os `try/catch` + toast existentes continuarem valendo. */
export function desembrulhar<T>(resultado: Resultado<T>): T {
  if (!resultado.ok) throw new Error(resultado.erro)
  return resultado.data
}
