'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'
import { lancarErroRpc } from '@/lib/rpc'
import { apelidoSchema, escopoSchema } from '@/lib/compartilhamento'

async function rpcAutenticado<T>(nome: string, args?: Record<string, unknown>): Promise<T> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')
  const { data, error } = await supabase.rpc(nome, args)
  if (error) lancarErroRpc(error)
  return data as T
}

/** Pede amizade pelo apelido. Só vale quando a outra pessoa aceitar (ou se ela já tinha pedido a você). */
async function solicitarAmizadeImpl(apelido: string) {
  const a = apelidoSchema.parse(apelido)
  await rpcAutenticado<string>('amizade_solicitar', { p_apelido: a })
  revalidatePath('/amigos')
}
export async function solicitarAmizade(apelido: string) {
  return executar(() => solicitarAmizadeImpl(apelido))
}

async function responderAmizadeImpl(id: string, aceitar: boolean) {
  await rpcAutenticado('amizade_responder', { p_amizade: z.string().uuid().parse(id), p_aceitar: z.boolean().parse(aceitar) })
  revalidatePath('/amigos')
}
export async function responderAmizade(id: string, aceitar: boolean) {
  return executar(() => responderAmizadeImpl(id, aceitar))
}

/** Desfaz a amizade (ou cancela o pedido enviado). O acesso às coleções some na hora, nos dois sentidos. */
async function desfazerAmizadeImpl(id: string) {
  await rpcAutenticado('amizade_desfazer', { p_amizade: z.string().uuid().parse(id) })
  revalidatePath('/amigos')
}
export async function desfazerAmizade(id: string) {
  return executar(() => desfazerAmizadeImpl(id))
}

/** Convite por link: devolve o código (o endereço é `/amigos/convite/<código>`). Gerar outro invalida o anterior. */
async function gerarConviteImpl() {
  return rpcAutenticado<string>('convite_gerar')
}
export async function gerarConvite() {
  return executar(() => gerarConviteImpl())
}

const codigoSchema = z.string().regex(/^[0-9a-f]{32,64}$/, 'Convite inválido')

/** Quem abre o link e confirma fecha o aceite dos dois lados. Devolve o apelido do novo amigo. */
async function aceitarConviteImpl(codigo: string) {
  const apelido = await rpcAutenticado<string>('convite_aceitar', { p_codigo: codigoSchema.parse(codigo) })
  revalidatePath('/amigos')
  return apelido
}
export async function aceitarConvite(codigo: string) {
  return executar(() => aceitarConviteImpl(codigo))
}

/** Seções que os amigos aceitos enxergam (independente do link público). */
async function atualizarEscopoDosAmigosImpl(escopo: string[]) {
  await rpcAutenticado('amigos_escopo_atualizar', { p_escopo: escopoSchema.parse(escopo) })
  revalidatePath('/amigos')
}
export async function atualizarEscopoDosAmigos(escopo: string[]) {
  return executar(() => atualizarEscopoDosAmigosImpl(escopo))
}

const itemIdSchema = z.string().uuid()

/** "Vou dar esse": reserva um desejo de um amigo. O dono da lista nunca vê a marcação. */
async function marcarPresenteImpl(itemId: string, apelido: string) {
  await rpcAutenticado('presente_marcar', { p_item: itemIdSchema.parse(itemId) })
  revalidatePath(`/amigos/${apelidoSchema.parse(apelido)}/desejos`)
}
export async function marcarPresente(itemId: string, apelido: string) {
  return executar(() => marcarPresenteImpl(itemId, apelido))
}

async function desmarcarPresenteImpl(itemId: string, apelido: string) {
  await rpcAutenticado('presente_desmarcar', { p_item: itemIdSchema.parse(itemId) })
  revalidatePath(`/amigos/${apelidoSchema.parse(apelido)}/desejos`)
}
export async function desmarcarPresente(itemId: string, apelido: string) {
  return executar(() => desmarcarPresenteImpl(itemId, apelido))
}
