import { z, ZodError } from 'zod'
import { ErroDeNegocio, type Resultado } from '@/lib/resultado'

// Mensagens de validação do Zod em português (as próprias do schema, como 'Nome obrigatório', têm prioridade).
z.config(z.locales.pt())

const MENSAGEM_GENERICA = 'Não foi possível concluir a operação. Tente novamente.'

function mensagemDoErroInesperado(e: unknown): string {
  const texto = e instanceof Error ? e.message : ''
  if (/duplicate key|unique constraint/i.test(texto)) return 'Já existe um registro com esses dados.'
  if (/numeric field overflow|out of range/i.test(texto)) return 'Um dos números informados é grande demais.'
  return MENSAGEM_GENERICA
}

/** Executa a action e converte falhas em `Resultado`; só o erro esperado/validação mostra o texto real. */
export async function executar<T>(fn: () => Promise<T>): Promise<Resultado<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    if (e instanceof ErroDeNegocio) return { ok: false, erro: e.message }
    if (e instanceof ZodError) {
      const problema = e.issues[0]
      const campo = problema?.path.join('.')
      return { ok: false, erro: problema ? (campo ? `${campo}: ${problema.message}` : problema.message) : 'Dados inválidos' }
    }
    console.error('[action]', e)
    return { ok: false, erro: mensagemDoErroInesperado(e) }
  }
}
