'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'
import { apelidoSchema, escopoSchema, nomeExibicaoSchema } from '@/lib/compartilhamento'
import { lancarErroRpc } from '@/lib/rpc'
import { detectarTipoDeImagem, EXT_POR_MIME_IMAGEM, removerMetadados } from '@/lib/imagem'
import { BUCKET_AVATARES, caminhoDeAvatar, MAX_BYTES_AVATAR, urlPublicaDeAvatar } from '@/lib/avatar'

const contribuirSchema = z.boolean()

/** Liga ou desliga "Contribuir com as capas que eu enviar". Cria o perfil na primeira vez; desligado é o padrão. */
async function definirContribuirCapasImpl(valor: boolean) {
  const contribuir = contribuirSchema.parse(valor)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const { error } = await supabase
    .from('perfis')
    .upsert({ user_id: user.id, contribuir_capas: contribuir }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)

  revalidatePath('/configuracoes')
  return contribuir
}

export async function definirContribuirCapas(valor: boolean) {
  return executar(() => definirContribuirCapasImpl(valor))
}

/** Apelido (único) e nome de exibição: é como amigos e quem abre o link enxergam você. */
async function salvarPerfilImpl(input: { apelido: string; nome_exibicao: string }) {
  const apelido = apelidoSchema.parse(input.apelido)
  const nome = nomeExibicaoSchema.parse(input.nome_exibicao)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const { error } = await supabase
    .from('perfis')
    .upsert({ user_id: user.id, apelido, nome_exibicao: nome || null }, { onConflict: 'user_id' })
  if (error) {
    if (error.code === '23505') throw new ErroDeNegocio('Esse apelido já está em uso. Escolha outro.')
    throw new Error(error.message)
  }
  revalidatePath('/configuracoes')
  return { apelido }
}

export async function salvarPerfil(input: { apelido: string; nome_exibicao: string }) {
  return executar(() => salvarPerfilImpl(input))
}

/** Gera um link novo (o anterior, se houver, deixa de valer na hora) com as seções escolhidas. */
async function gerarLinkImpl(escopo: string[]) {
  const e = escopoSchema.parse(escopo)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('compartilhamento_gerar', { p_escopo: e })
  if (error) lancarErroRpc(error)
  revalidatePath('/configuracoes')
  return data as string
}

export async function gerarLink(escopo: string[]) {
  return executar(() => gerarLinkImpl(escopo))
}

async function revogarLinkImpl() {
  const supabase = await createClient()
  const { error } = await supabase.rpc('compartilhamento_revogar')
  if (error) lancarErroRpc(error)
  revalidatePath('/configuracoes')
}

export async function revogarLink() {
  return executar(() => revogarLinkImpl())
}

async function atualizarEscopoDoLinkImpl(escopo: string[]) {
  const e = escopoSchema.parse(escopo)
  const supabase = await createClient()
  const { error } = await supabase.rpc('compartilhamento_escopo_atualizar', { p_escopo: e })
  if (error) lancarErroRpc(error)
  revalidatePath('/configuracoes')
}

export async function atualizarEscopoDoLink(escopo: string[]) {
  return executar(() => atualizarEscopoDoLinkImpl(escopo))
}

/**
 * Foto de perfil. O navegador já mandou a imagem quadrada e redimensionada (canvas, que também descarta
 * os metadados); aqui o servidor não confia nisso: confere o tipo pelos bytes, o tamanho e tira qualquer
 * metadado de novo antes de gravar em `avatares/<uid>/<aleatório>.<ext>`.
 */
async function salvarAvatarImpl(formData: FormData) {
  const arquivo = formData.get('foto')
  if (!(arquivo instanceof File)) throw new ErroDeNegocio('Escolha uma imagem.')
  if (arquivo.size === 0) throw new ErroDeNegocio('A imagem está vazia.')
  if (arquivo.size > MAX_BYTES_AVATAR) throw new ErroDeNegocio('A foto ficou grande demais. Tente outra imagem.')

  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  if (!detectarTipoDeImagem(bytes)) throw new ErroDeNegocio('Use uma imagem JPEG, PNG ou WebP.')
  const limpa = removerMetadados(bytes)
  if (!limpa || limpa.bytes.length === 0) throw new ErroDeNegocio('Não consegui ler essa imagem.')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const { data: atual } = await supabase.from('perfis').select('avatar_url').eq('user_id', user.id).maybeSingle()
  const caminho = `${user.id}/${crypto.randomUUID().replaceAll('-', '')}.${EXT_POR_MIME_IMAGEM[limpa.mime]}`
  const url = urlPublicaDeAvatar(caminho)
  if (!url) throw new Error('Supabase não configurado')

  const { error: erroUpload } = await supabase.storage.from(BUCKET_AVATARES).upload(caminho, limpa.bytes, {
    contentType: limpa.mime,
    cacheControl: '31536000',
    upsert: false,
  })
  if (erroUpload) throw new Error(erroUpload.message)

  const { error } = await supabase.from('perfis').upsert({ user_id: user.id, avatar_url: url }, { onConflict: 'user_id' })
  if (error) {
    await supabase.storage.from(BUCKET_AVATARES).remove([caminho])
    throw new Error(error.message)
  }
  await apagarArquivoAntigo(supabase, atual?.avatar_url, caminho)
  revalidatePath('/', 'layout')
  return { url }
}

export async function salvarAvatar(formData: FormData) {
  return executar(() => salvarAvatarImpl(formData))
}

async function removerAvatarImpl() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const { data: atual } = await supabase.from('perfis').select('avatar_url').eq('user_id', user.id).maybeSingle()
  const { error } = await supabase.from('perfis').update({ avatar_url: null }).eq('user_id', user.id)
  if (error) throw new Error(error.message)
  await apagarArquivoAntigo(supabase, atual?.avatar_url, null)
  revalidatePath('/', 'layout')
}

export async function removerAvatar() {
  return executar(() => removerAvatarImpl())
}

/** Apaga o arquivo da foto anterior; falha aqui não desfaz a troca (sobra um arquivo órfão, nunca um perfil quebrado). */
async function apagarArquivoAntigo(supabase: Awaited<ReturnType<typeof createClient>>, urlAntiga: string | null | undefined, caminhoNovo: string | null) {
  const antigo = caminhoDeAvatar(urlAntiga)
  if (!antigo || antigo === caminhoNovo) return
  const { error } = await supabase.storage.from(BUCKET_AVATARES).remove([antigo])
  if (error) console.error('[avatar] não removeu arquivo antigo', antigo, error.message)
}

const favoritosSchema = z.array(z.string().uuid()).max(4, 'Você pode ter no máximo 4 séries favoritas. Tire uma para escolher outra.')

/** Grava a lista inteira dos favoritos (até 4), na ordem recebida; o banco confere dono, limite e repetidas. */
async function salvarFavoritosSeriesImpl(ids: string[]) {
  const lista = favoritosSchema.parse(ids)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const { error } = await supabase.rpc('favoritos_series_salvar', { p_series: lista })
  if (error) lancarErroRpc(error)
  revalidatePath('/configuracoes')
  revalidatePath('/amigos', 'layout')
}

export async function salvarFavoritosSeries(ids: string[]) {
  return executar(() => salvarFavoritosSeriesImpl(ids))
}
