'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { executar } from '@/lib/executar'
import { ErroDeNegocio } from '@/lib/resultado'
import { escaparLike } from '@/lib/like'
import { LINHAS_POR_LOTE, type LinhaCsv } from '@/lib/csv-importacao'
import { dividirValores, LINHAS_POR_LOTE_PREVIA, limparCelula, type Mudanca } from '@/lib/planilha'
import {
  buscarSerieIdPorNome,
  classificarLinhas,
  itemJaExiste,
  type LinhaClassificada,
} from '@/lib/importar-itens'
import { aplicarCapaDeApi } from '@/lib/capa-catalogo'
import { gravarChaveDoItem } from '@/lib/obra-chaves'
import {
  buscarCapaPorIsbn,
  buscarCapaPorMemoria,
  type MemoriaSerie,
  type Provedor,
} from '@/lib/capa-busca'
import type { TipoObra, TipoTag } from '@/lib/types'

export type RascunhoRow = LinhaCsv & { id?: string; nota?: string; lido_em?: string }

export type ResumoImportacao = {
  itensCriados: number
  itensAtualizados: number
  itensSemMudanca: number
  itensIgnorados: number
  seriesCriadas: number
  tagsCriadas: number
  capasAplicadas: number
  erros: { linha: number; motivo: string }[]
}

async function importarCsvImpl(rowsBrutas: unknown[], primeiraLinha: number): Promise<ResumoImportacao> {
  if (!Array.isArray(rowsBrutas) || rowsBrutas.length > LINHAS_POR_LOTE * 2) {
    throw new ErroDeNegocio('Lote de importação inválido.')
  }
  const linhaInicial = Number.isInteger(primeiraLinha) && primeiraLinha >= 2 ? primeiraLinha : 2

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const resumo: ResumoImportacao = {
    itensCriados: 0,
    itensAtualizados: 0,
    itensSemMudanca: 0,
    itensIgnorados: 0,
    seriesCriadas: 0,
    tagsCriadas: 0,
    capasAplicadas: 0,
    erros: [],
  }

  const serieCache = new Map<string, string>()
  const tagCache = new Map<string, string>()
  const memoriaSerieCache = new Map<string, MemoriaSerie>()

  async function obterMemoriaSerie(serieId: string): Promise<MemoriaSerie> {
    const cached = memoriaSerieCache.get(serieId)
    if (cached) return cached
    const { data } = await supabase
      .from('series')
      .select('busca_termo, busca_provedor, busca_ref')
      .eq('id', serieId)
      .maybeSingle<{ busca_termo: string | null; busca_provedor: Provedor | null; busca_ref: string | null }>()
    const memoria: MemoriaSerie = {
      termo: data?.busca_termo ?? null,
      provedor: data?.busca_provedor ?? null,
      ref: data?.busca_ref ?? null,
    }
    memoriaSerieCache.set(serieId, memoria)
    return memoria
  }

  async function resolverSerie(nome: string, tipo: TipoObra): Promise<string> {
    const key = nome.trim().toLowerCase()
    const cached = serieCache.get(key)
    if (cached) return cached

    // `escaparLike`: o nome é literal ("CSV_Wild" não pode casar com "CSV Wild"); `limit(1)`
    // porque duas séries só diferentes na caixa fariam `maybeSingle` falhar e criar uma terceira.
    const { data: existentes, error: erroBusca } = await supabase
      .from('series')
      .select('id')
      .eq('user_id', user!.id)
      .ilike('nome', escaparLike(nome.trim()))
      .order('created_at')
      .limit(1)
    if (erroBusca) throw new Error(erroBusca.message)

    if (existentes && existentes.length > 0) {
      serieCache.set(key, existentes[0].id)
      return existentes[0].id
    }

    const { data: nova, error } = await supabase
      .from('series')
      .insert({ user_id: user!.id, nome: nome.trim(), tipo })
      .select('id')
      .single()
    if (error) throw new Error(error.message)

    serieCache.set(key, nova.id)
    resumo.seriesCriadas++
    return nova.id
  }

  async function resolverTag(nome: string, tipo: TipoTag): Promise<string> {
    const key = `${tipo}:${nome.trim().toLowerCase()}`
    const cached = tagCache.get(key)
    if (cached) return cached

    const { data: existentes, error: erroBusca } = await supabase
      .from('tags')
      .select('id')
      .eq('user_id', user!.id)
      .eq('tipo', tipo)
      .ilike('nome', escaparLike(nome.trim()))
      .order('created_at')
      .limit(1)
    if (erroBusca) throw new Error(erroBusca.message)

    if (existentes && existentes.length > 0) {
      tagCache.set(key, existentes[0].id)
      return existentes[0].id
    }

    const { data: nova, error } = await supabase
      .from('tags')
      .insert({ user_id: user!.id, nome: nome.trim(), tipo })
      .select('id')
      .single()
    if (error) throw new Error(error.message)

    tagCache.set(key, nova.id)
    resumo.tagsCriadas++
    return nova.id
  }

  // A classificação (erro / novo / atualização) é a mesma da prévia: o que foi mostrado é o que se aplica.
  const classificadas = await classificarLinhas(supabase, user.id, rowsBrutas, linhaInicial)

  async function ligarTag(itemId: string, serieId: string | null, tagId: string) {
    // Item com série: a tag vai para a série (como na criação); sem série, para o item.
    const { error } = serieId
      ? await supabase.from('serie_tags').upsert({ serie_id: serieId, tag_id: tagId }, { onConflict: 'serie_id,tag_id' })
      : await supabase.from('item_tags').upsert({ item_id: itemId, tag_id: tagId }, { onConflict: 'item_id,tag_id' })
    if (error) throw new Error(error.message)
  }

  for (const c of classificadas) {
    const linha = c.linha
    try {
      if (c.tipo === 'erro') {
        resumo.erros.push({ linha, motivo: c.motivo })
        continue
      }

      if (c.tipo === 'atualizar') {
        const { campos, tagsNovas } = c.plano
        if (Object.keys(campos).length === 0 && tagsNovas.length === 0) {
          resumo.itensSemMudanca++
          continue
        }
        if (Object.keys(campos).length > 0) {
          const { error } = await supabase.from('itens').update(campos).eq('id', c.item.id).eq('user_id', user.id)
          if (error) {
            if (error.code === '23505') {
              resumo.erros.push({ linha, motivo: 'já existe outro item com este número na série' })
              continue
            }
            throw new Error(error.message)
          }
          // A chave da obra (0019) vem de série + número + título + tipo; o `completarChaves` só preenche chave vazia.
          if (campos.titulo !== undefined || campos.numero_volume !== undefined || campos.tipo !== undefined) {
            await gravarChaveDoItem(supabase, c.item.id)
          }
        }
        for (const t of tagsNovas) {
          const tagId = await resolverTag(t.nome, t.tipo)
          await ligarTag(c.item.id, t.tipo === 'outro' ? null : c.item.serie_id, tagId)
        }
        resumo.itensAtualizados++
        // ISBN novo num item sem capa: tenta a capa, como na criação.
        if (campos.isbn && !c.item.capa_url) {
          const resultado = await buscarCapaPorIsbn(campos.isbn)
          if (resultado && (await aplicarCapaDeApi(supabase, c.item.id, resultado.url))) resumo.capasAplicadas++
        }
        continue
      }

      const row = c.row
      const { tipo, estado, numeroVolume, titulo, isbn } = c.dados
      const serieNome = limparCelula(row.serie)

      let serieId: string | null = null
      if (serieNome) {
        serieId = await resolverSerie(serieNome, tipo)
      }

      const seloRow = limparCelula(row.selo).toLowerCase() || null

      if (await itemJaExiste(supabase, user.id, { serieId, numeroVolume, titulo, selo: seloRow })) {
        resumo.itensIgnorados++
        continue
      }

      const tagIdsSerieOuItem: string[] = []
      const camposTag: { valor?: string; tipo: TipoTag }[] = [
        { valor: row.editora, tipo: 'editora' },
        { valor: row.universo, tipo: 'universo' },
        { valor: row.personagem, tipo: 'personagem' },
        { valor: row.selo, tipo: 'selo' },
        { valor: row.autor, tipo: 'autor' },
      ]
      for (const campo of camposTag) {
        // "A; B" vira duas tags (é como a planilha exportada escreve vários valores).
        for (const nomeTag of dividirValores(campo.valor)) {
          tagIdsSerieOuItem.push(await resolverTag(nomeTag, campo.tipo))
        }
      }

      if (serieId && tagIdsSerieOuItem.length > 0) {
        const linksSerie = tagIdsSerieOuItem.map((tag_id) => ({ serie_id: serieId!, tag_id }))
        const { error: erroTagsSerie } = await supabase
          .from('serie_tags')
          .upsert(linksSerie, { onConflict: 'serie_id,tag_id' })
        if (erroTagsSerie) throw new Error(erroTagsSerie.message)
      }

      const tagIdsDoItem: string[] = serieId ? [] : [...tagIdsSerieOuItem]
      for (const nomeTag of dividirValores(row.tags_extra)) {
        tagIdsDoItem.push(await resolverTag(nomeTag, 'outro'))
      }

      const { data: item, error: itemError } = await supabase
        .from('itens')
        .insert({
          user_id: user.id,
          serie_id: serieId,
          titulo,
          numero_volume: numeroVolume,
          tipo,
          isbn,
          estado,
          critica: limparCelula(row.critica) || null,
          nota: c.dados.nota,
          // O banco zera `lido_em` quando o item não é lido (trigger da 0010).
          lido_em: c.dados.lidoEm,
        })
        .select('id')
        .single()
      if (itemError) throw new Error(itemError.message)

      if (tagIdsDoItem.length > 0) {
        const linksItem = tagIdsDoItem.map((tag_id) => ({ item_id: item.id, tag_id }))
        const { error: erroTagsItem } = await supabase.from('item_tags').insert(linksItem)
        if (erroTagsItem) throw new Error(erroTagsItem.message)
      }

      resumo.itensCriados++

      let capaAplicada = false

      if (isbn) {
        const resultado = await buscarCapaPorIsbn(isbn)
        if (resultado) {
          if (await aplicarCapaDeApi(supabase, item.id, resultado.url)) {
            resumo.capasAplicadas++
            capaAplicada = true
            if (serieId) {
              await supabase
                .from('series')
                .update({
                  busca_termo: serieNome || titulo,
                  busca_provedor: resultado.provedor,
                  busca_ref: null,
                  busca_atualizado_em: new Date().toISOString(),
                })
                .eq('id', serieId)
              memoriaSerieCache.delete(serieId)
            }
          }
        }
      }

      // Sem ISBN (ou ISBN não achou): se a série já tem um provedor com busca
      // por volume exato (MangaDex), aproveita em vez de deixar sem capa.
      // Não faz busca livre por título aqui — ambígua demais para aplicar
      // sem revisão, e queima quota de graça num lote grande.
      if (!capaAplicada && serieId) {
        const memoria = await obterMemoriaSerie(serieId)
        const candidato = await buscarCapaPorMemoria(memoria, numeroVolume)
        if (candidato) {
          if (await aplicarCapaDeApi(supabase, item.id, candidato.url)) resumo.capasAplicadas++
        }
      }
    } catch (e) {
      console.error('[importarCsv] linha', linha, e)
      resumo.erros.push({ linha, motivo: 'erro ao gravar esta linha' })
    }
  }

  revalidatePath('/colecao')
  revalidatePath('/desejos')
  revalidatePath('/series')
  revalidatePath('/tags')

  return resumo
}

/**
 * Importa um LOTE de linhas (o navegador envia o arquivo em pedaços de `LINHAS_POR_LOTE`).
 * `primeiraLinha` é o número da linha do arquivo da primeira linha do lote, para os erros apontarem a linha certa.
 */
export async function importarCsv(rows: unknown[], primeiraLinha: number) {
  return executar(() => importarCsvImpl(rows, primeiraLinha))
}

export type LinhaDaPrevia = { linha: number; rotulo: string; mudancas: Mudanca[]; avisos: string[] }

export type PreviaImportacao = {
  novos: number
  atualizados: number
  semMudanca: number
  erros: { linha: number; motivo: string }[]
  /** Itens que vão mudar, com campo antigo → novo. */
  atualizacoes: LinhaDaPrevia[]
  /** Linhas novas (rótulo só, para conferir). */
  novosItens: { linha: number; rotulo: string }[]
  /** Avisos de linhas sem mudança que mereciam atenção (ex.: série diferente). */
  avisos: { linha: number; texto: string }[]
}

async function previaImpl(rowsBrutas: unknown[], primeiraLinha: number): Promise<PreviaImportacao> {
  if (!Array.isArray(rowsBrutas) || rowsBrutas.length > LINHAS_POR_LOTE_PREVIA) {
    throw new ErroDeNegocio('Lote de importação inválido.')
  }
  const linhaInicial = Number.isInteger(primeiraLinha) && primeiraLinha >= 2 ? primeiraLinha : 2

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new ErroDeNegocio('Não autenticado')

  const previa: PreviaImportacao = { novos: 0, atualizados: 0, semMudanca: 0, erros: [], atualizacoes: [], novosItens: [], avisos: [] }
  const classificadas: LinhaClassificada[] = await classificarLinhas(supabase, user.id, rowsBrutas, linhaInicial)
  const serieCache = new Map<string, string | null>()

  for (const c of classificadas) {
    try {
      if (c.tipo === 'erro') {
        previa.erros.push({ linha: c.linha, motivo: c.motivo })
      } else if (c.tipo === 'atualizar') {
        const { mudancas, avisos, tagsNovas, campos } = c.plano
        if (Object.keys(campos).length === 0 && tagsNovas.length === 0) {
          previa.semMudanca++
          for (const texto of avisos) previa.avisos.push({ linha: c.linha, texto })
        } else {
          previa.atualizados++
          previa.atualizacoes.push({ linha: c.linha, rotulo: c.item.titulo, mudancas, avisos })
        }
      } else {
        // Mesma regra de duplicata da gravação, só que sem criar a série.
        const nomeSerie = limparCelula(c.row.serie)
        let serieId: string | null = null
        if (nomeSerie) {
          const chave = nomeSerie.toLowerCase()
          if (!serieCache.has(chave)) serieCache.set(chave, await buscarSerieIdPorNome(supabase, user.id, nomeSerie))
          serieId = serieCache.get(chave) ?? null
        }
        const serieNovaOuInexistente = Boolean(nomeSerie) && !serieId
        const existe =
          !serieNovaOuInexistente &&
          (await itemJaExiste(supabase, user.id, {
            serieId,
            numeroVolume: c.dados.numeroVolume,
            titulo: c.dados.titulo,
            selo: limparCelula(c.row.selo).toLowerCase() || null,
          }))
        if (existe) {
          previa.semMudanca++
        } else {
          previa.novos++
          previa.novosItens.push({ linha: c.linha, rotulo: c.dados.titulo })
        }
      }
    } catch (e) {
      console.error('[previaImportacao] linha', c.linha, e)
      previa.erros.push({ linha: c.linha, motivo: 'erro ao analisar esta linha' })
    }
  }
  return previa
}

/** Prévia de um LOTE: o que a importação faria (novos, atualizados, sem mudança, erros), sem gravar nada. */
export async function previaImportacao(rows: unknown[], primeiraLinha: number) {
  return executar(() => previaImpl(rows, primeiraLinha))
}
