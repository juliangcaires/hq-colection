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

const chaveSchema = z.string().trim().min(1).max(300)

/** Busca entre os itens dos amigos (só o que eles compartilham) para o vínculo "é a mesma obra que...". */
async function buscarObrasDeAmigosImpl(termo: string) {
  const t = z.string().trim().max(80).parse(termo)
  if (t.length < 2) return []
  const dados = await rpcAutenticado<Record<string, unknown>[]>('amigos_buscar_obras', { p_termo: t })
  return (dados ?? []).map((r) => ({
    obraChave: String(r.obra_chave),
    apelido: (r.apelido as string | null) ?? null,
    nome: (r.nome_exibicao as string | null) ?? null,
    titulo: (r.titulo as string | null) ?? '',
    numeroVolume: r.numero_volume === null || r.numero_volume === undefined ? null : Number(r.numero_volume),
    serieNome: (r.serie_nome as string | null) ?? null,
  }))
}
export async function buscarObrasDeAmigos(termo: string) {
  return executar(() => buscarObrasDeAmigosImpl(termo))
}

/** "É a mesma obra que...": vale só na visão de quem vinculou. */
async function vincularObraImpl(obraChave: string, chaveAmigo: string, itemId: string) {
  await rpcAutenticado('obra_equivalencia_criar', { p_obra_chave: chaveSchema.parse(obraChave), p_chave_amigo: chaveSchema.parse(chaveAmigo) })
  revalidatePath(`/item/${z.string().uuid().parse(itemId)}`)
}
export async function vincularObra(obraChave: string, chaveAmigo: string, itemId: string) {
  return executar(() => vincularObraImpl(obraChave, chaveAmigo, itemId))
}

async function desvincularObraImpl(obraChave: string, chaveAmigo: string, itemId: string) {
  await rpcAutenticado('obra_equivalencia_desfazer', { p_obra_chave: chaveSchema.parse(obraChave), p_chave_amigo: chaveSchema.parse(chaveAmigo) })
  revalidatePath(`/item/${z.string().uuid().parse(itemId)}`)
}
export async function desvincularObra(obraChave: string, chaveAmigo: string, itemId: string) {
  return executar(() => desvincularObraImpl(obraChave, chaveAmigo, itemId))
}
