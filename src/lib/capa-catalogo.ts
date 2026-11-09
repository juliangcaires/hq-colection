import type { SupabaseClient } from '@supabase/supabase-js'
import { baixarImagemSegura, type CandidatoCapa, type MemoriaSerie, type NivelComunidade, type Provedor } from '@/lib/capa-busca'
import { urlPublicaDeCapa } from '@/lib/supabase/capas'
import { detectarTipoDeImagem, EXT_POR_MIME_IMAGEM, removerMetadados, sha256Hex } from '@/lib/imagem'
import { normalizarIsbn } from '@/lib/isbn'
import { chaveEdicao, normalizarParaChave } from '@/lib/texto'

/**
 * Capas compartilhadas: publica a imagem no bucket `capas-publicas` com nome = SHA-256 (mesma imagem,
 * mesmo arquivo), registra no catálogo e aponta o item para ela (`itens.capa_url = 'pub/<hash>.<ext>'`).
 * Só servidor. Nada aqui lança: capa é acessório e quem chama decide o que fazer com `null`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any>

/** Prefixo de `itens.capa_url` que marca uma capa do catálogo público (as privadas começam pelo id do usuário). */
export const PREFIXO_CAPA_PUBLICA = 'pub/'

export type ChavesDoItem = {
  isbn13: string | null
  /** Série + número + tipo + editora (a mesma de `edicoes.chave_normalizada`). */
  chave: string
  /** Só série + tipo: base da sugestão "o nome bate". Null em item avulso. */
  serieChave: string | null
}

type TagRef = { nome: string; tipo: string }

/** Identificadores do item no catálogo. A editora vem das tags do item ou, na falta, da série. */
export async function chavesDoItem(supabase: Cliente, itemId: string): Promise<ChavesDoItem | null> {
  const { data } = await supabase
    .from('itens')
    .select('titulo, numero_volume, tipo, isbn, serie:series(nome, serie_tags(tags(nome, tipo))), item_tags(tags(nome, tipo))')
    .eq('id', itemId)
    .maybeSingle<{
      titulo: string
      numero_volume: number | string | null
      tipo: 'hq' | 'manga'
      isbn: string | null
      serie: { nome: string; serie_tags: { tags: TagRef | null }[] | null } | null
      item_tags: { tags: TagRef | null }[] | null
    }>()
  if (!data) return null

  const tags = [...(data.item_tags ?? []), ...(data.serie?.serie_tags ?? [])].map((t) => t.tags).filter((t): t is TagRef => Boolean(t))
  const editora = tags.find((t) => t.tipo === 'editora')?.nome ?? null
  const serieNome = data.serie?.nome ?? null
  return {
    isbn13: data.isbn ? normalizarIsbn(data.isbn) : null,
    chave: chaveEdicao({
      serie: serieNome ?? data.titulo,
      numero: data.numero_volume === null ? null : Number(data.numero_volume),
      tipo: data.tipo,
      editora,
    }),
    serieChave: serieNome ? `${normalizarParaChave(serieNome)}|${data.tipo}` : null,
  }
}

/** Sobe a imagem para o bucket público. Arquivo que já existe (mesmo hash) conta como sucesso. */
async function publicar(
  supabase: Cliente,
  bytes: Uint8Array,
  mime: keyof typeof EXT_POR_MIME_IMAGEM
): Promise<{ caminho: string; hash: string } | null> {
  const hash = await sha256Hex(bytes)
  const caminho = `${hash}.${EXT_POR_MIME_IMAGEM[mime]}`
  const { error } = await supabase.storage.from('capas-publicas').upload(caminho, bytes, { contentType: mime, upsert: false })
  if (error && !/already exists|duplicate/i.test(error.message)) {
    console.warn('[capa-catalogo] upload público falhou:', error.message)
    return null
  }
  return { caminho, hash }
}

async function registrarEAplicar(
  supabase: Cliente,
  itemId: string,
  publicada: { caminho: string; hash: string },
  origem: 'api' | 'foto'
): Promise<string | null> {
  const chaves = await chavesDoItem(supabase, itemId)
  if (!chaves) return null
  const { error } = await supabase.rpc('capa_catalogo_registrar', {
    p_isbn13: chaves.isbn13,
    p_chave: chaves.chave,
    p_serie_chave: chaves.serieChave,
    p_caminho: publicada.caminho,
    p_hash: publicada.hash,
    p_origem: origem,
    p_item: itemId,
  })
  if (error) {
    console.warn('[capa-catalogo] registro falhou:', error.message)
    return null
  }
  return `${PREFIXO_CAPA_PUBLICA}${publicada.caminho}`
}

/**
 * Capa vinda de API/provedor: baixa (só hosts permitidos), publica, registra no catálogo e aplica ao item.
 * Devolve o novo `capa_url` do item ou null. A imagem não é alterada, então duas pessoas que baixam a
 * mesma capa chegam ao mesmo hash e o catálogo não duplica.
 */
export async function aplicarCapaDeApi(supabase: Cliente, itemId: string, imageUrl: string): Promise<string | null> {
  try {
    const baixada = await baixarImagemSegura(imageUrl)
    if (!baixada) return null
    const mime = detectarTipoDeImagem(baixada.buffer) // o cabeçalho HTTP não basta para um arquivo público
    if (!mime) return null
    const publicada = await publicar(supabase, baixada.buffer, mime)
    return publicada ? await registrarEAplicar(supabase, itemId, publicada, 'api') : null
  } catch (e) {
    console.warn('[capa-catalogo] capa de API não aplicada:', e instanceof Error ? e.message : 'erro')
    return null
  }
}

/** O usuário ligou "Contribuir com as capas que eu enviar"? Desligado é o padrão. */
export async function usuarioContribuiCapas(supabase: Cliente, userId: string): Promise<boolean> {
  const { data } = await supabase.from('perfis').select('contribuir_capas').eq('user_id', userId).maybeSingle()
  return data?.contribuir_capas === true
}

/**
 * Foto enviada pelo usuário que optou por contribuir: remove metadados (GPS, aparelho, data), publica
 * e registra. Sem opt-in quem chama nem deve chegar aqui (o banco também recusa). null = não publicou.
 */
export async function aplicarFotoDoUsuario(supabase: Cliente, itemId: string, bytes: Uint8Array): Promise<string | null> {
  try {
    const limpa = removerMetadados(bytes)
    if (!limpa) return null
    const publicada = await publicar(supabase, limpa.bytes, limpa.mime)
    return publicada ? await registrarEAplicar(supabase, itemId, publicada, 'foto') : null
  } catch (e) {
    console.warn('[capa-catalogo] foto não publicada:', e instanceof Error ? e.message : 'erro')
    return null
  }
}

// ---------------------------------------------------------------------------------------------
// Busca na comunidade
// ---------------------------------------------------------------------------------------------

export type CapaDaComunidade = {
  id: string
  caminho: string
  origem: 'api' | 'foto'
  nivel: NivelComunidade
  usos: number
}

/** Capas do catálogo para o item: por ISBN, depois por chave, depois só pelo nome da série. */
export async function buscarCapasDaComunidade(supabase: Cliente, chaves: ChavesDoItem | null): Promise<CapaDaComunidade[]> {
  if (!chaves) return []
  try {
    const { data, error } = await supabase.rpc('capas_comunidade_buscar', {
      p_isbn13: chaves.isbn13,
      p_chave: chaves.chave,
      p_serie_chave: chaves.serieChave,
    })
    if (error) throw new Error(error.message)
    return (data ?? []) as CapaDaComunidade[]
  } catch (e) {
    // O catálogo é acessório: sem ele a busca segue só com os provedores.
    console.warn('[capa-catalogo] busca na comunidade falhou:', e instanceof Error ? e.message : 'erro')
    return []
  }
}

/** Forma da grade: URL pública da capa, id do catálogo em `ref` e a contagem de usos. */
export function candidatosDaComunidade(capas: CapaDaComunidade[]): (CandidatoCapa & { nivel: NivelComunidade })[] {
  return capas.map((c) => ({
    url: urlPublicaDeCapa(`${PREFIXO_CAPA_PUBLICA}${c.caminho}`),
    label: c.origem === 'foto' ? 'Foto de outro colecionador' : 'Capa da comunidade',
    provedor: 'comunidade' as const,
    ref: c.id,
    usos: c.usos,
    nivel: c.nivel,
  }))
}

/** Memória de busca da série compartilhada entre usuários (por série + tipo normalizados). */
export async function memoriaGlobalDaSerie(supabase: Cliente, serieChave: string | null): Promise<MemoriaSerie | null> {
  if (!serieChave) return null
  const { data } = await supabase
    .from('series_busca_global')
    .select('termo, provedor, ref')
    .eq('serie_chave', serieChave)
    .maybeSingle<{ termo: string | null; provedor: Provedor; ref: string | null }>()
  return data ? { termo: data.termo, provedor: data.provedor, ref: data.ref } : null
}

/** Conta uma confirmação da resolução que funcionou nesta série (ver `series_busca_global_registrar`). Não lança. */
export async function registrarMemoriaGlobal(
  supabase: Cliente,
  serieChave: string | null,
  termo: string,
  provedor: string,
  ref: string | null
): Promise<void> {
  if (!serieChave || provedor === 'comunidade') return
  const { error } = await supabase.rpc('series_busca_global_registrar', {
    p_serie_chave: serieChave,
    p_termo: termo,
    p_provedor: provedor,
    p_ref: ref,
  })
  if (error) console.warn('[capa-catalogo] memória global não registrada:', error.message)
}
