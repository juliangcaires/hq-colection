'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'
import { lancarErroRpc } from '@/lib/rpc'
import { emprestimoInputSchema, type EmprestimoInput } from '@/lib/emprestimos'

function revalidar(itemId?: string) {
  revalidatePath('/emprestimos')
  revalidatePath('/')
  if (itemId) revalidatePath(`/item/${itemId}`)
}

/** Registra para quem e quando um item seu foi emprestado. Só item que você tem; um empréstimo aberto por item. */
async function registrarEmprestimoImpl(input: EmprestimoInput) {
  const p = emprestimoInputSchema.parse(input)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const { data, error } = await supabase.rpc('emprestimo_registrar', {
    p_item: p.itemId,
    p_para: p.paraQuem,
    p_emprestado_em: p.emprestadoEm || null,
    p_devolver_ate: p.devolverAte || null,
    p_obs: p.observacao || null,
  })
  if (error) lancarErroRpc(error)
  revalidar(p.itemId)
  return data as string
}
export async function registrarEmprestimo(input: EmprestimoInput) {
  return executar(() => registrarEmprestimoImpl(input))
}

async function devolverEmprestimoImpl(id: string, itemId?: string) {
  const emprestimoId = z.string().uuid().parse(id)
  const supabase = await createClient()
  const { error } = await supabase.rpc('emprestimo_devolver', { p_id: emprestimoId, p_data: null })
  if (error) lancarErroRpc(error)
  revalidar(itemId ? z.string().uuid().parse(itemId) : undefined)
}
export async function devolverEmprestimo(id: string, itemId?: string) {
  return executar(() => devolverEmprestimoImpl(id, itemId))
}
