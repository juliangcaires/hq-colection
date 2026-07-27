'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  baixarEPersistirCapa,
  buscarCapaPorIsbn,
  buscarCapaPorMemoria,
  type MemoriaSerie,
  type Provedor,
} from '@/lib/capa-busca'
import type { EstadoItem, TipoObra, TipoTag, Tag } from '@/lib/types'

export type RascunhoRow = {
  titulo?: string
  serie?: string
  numero_volume?: string
  tipo?: string
  estado?: string
  editora?: string
  universo?: string
  personagem?: string
  selo?: string
  autor?: string
  isbn?: string
  tags_extra?: string
  observacoes?: string
}

export type ResumoImportacao = {
  itensCriados: number
  itensIgnorados: number
  seriesCriadas: number
  tagsCriadas: number
  capasAplicadas: number
  erros: { linha: number; motivo: string }[]
}

const ESTADOS_VALIDOS: EstadoItem[] = ['desejo', 'comprado', 'lido']

export async function importarCsv(rows: RascunhoRow[]): Promise<ResumoImportacao> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const resumo: ResumoImportacao = {
    itensCriados: 0,
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

    const { data: existente } = await supabase
      .from('series')
      .select('id')
      .eq('user_id', user!.id)
      .ilike('nome', nome.trim())
      .maybeSingle()

    if (existente) {
      serieCache.set(key, existente.id)
      return existente.id
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

    const { data: existente } = await supabase
      .from('tags')
      .select('id')
      .eq('user_id', user!.id)
      .eq('tipo', tipo)
      .ilike('nome', nome.trim())
      .maybeSingle()

    if (existente) {
      tagCache.set(key, existente.id)
      return existente.id
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

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const tipo: TipoObra = row.tipo?.trim() === 'manga' ? 'manga' : 'hq'
      const estadoBruto = row.estado?.trim() as EstadoItem | undefined
      const estado: EstadoItem = estadoBruto && ESTADOS_VALIDOS.includes(estadoBruto) ? estadoBruto : 'comprado'
      const numeroVolume = row.numero_volume?.trim() ? Number(row.numero_volume) : null

      let serieId: string | null = null
      if (row.serie?.trim()) {
        serieId = await resolverSerie(row.serie, tipo)
      }

      const titulo =
        row.titulo?.trim() ||
        (row.serie?.trim()
          ? `${row.serie.trim()}${numeroVolume != null ? ` #${numeroVolume}` : ''}`
          : '')

      if (!titulo) {
        resumo.erros.push({ linha: i + 2, motivo: 'sem título nem série — linha ignorada' })
        continue
      }

      const seloRow = row.selo?.trim().toLowerCase() || null

      if (serieId) {
        let queryDuplicata = supabase
          .from('itens')
          .select('id')
          .eq('user_id', user.id)
          .eq('serie_id', serieId)
        // numeroVolume pode ser null — `.eq(col, null)` nunca casa no PostgREST,
        // então sem isso linhas sem volume nunca eram dedupadas.
        queryDuplicata =
          numeroVolume === null
            ? queryDuplicata.is('numero_volume', null)
            : queryDuplicata.eq('numero_volume', numeroVolume)
        const { data: existente } = await queryDuplicata.maybeSingle()
        if (existente) {
          resumo.itensIgnorados++
          continue
        }
      } else {
        // Sem série: título sozinho não basta — edições diferentes do mesmo
        // título (ex: capa normal vs. "DC de Bolso") são itens distintos.
        const { data: candidatos } = await supabase
          .from('itens')
          .select('id, item_tags(tags(nome, tipo))')
          .eq('user_id', user.id)
          .is('serie_id', null)
          .ilike('titulo', titulo)
          .returns<{ id: string; item_tags: { tags: Pick<Tag, 'nome' | 'tipo'> | null }[] | null }[]>()
        const jaExiste = (candidatos ?? []).some((c) => {
          const seloCandidato =
            (c.item_tags ?? [])
              .map((it) => it.tags)
              .find((t) => t?.tipo === 'selo')
              ?.nome.trim()
              .toLowerCase() || null
          return seloCandidato === seloRow
        })
        if (jaExiste) {
          resumo.itensIgnorados++
          continue
        }
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
        if (campo.valor?.trim()) {
          tagIdsSerieOuItem.push(await resolverTag(campo.valor, campo.tipo))
        }
      }

      if (serieId && tagIdsSerieOuItem.length > 0) {
        const linksSerie = tagIdsSerieOuItem.map((tag_id) => ({ serie_id: serieId!, tag_id }))
        await supabase.from('serie_tags').upsert(linksSerie, { onConflict: 'serie_id,tag_id' })
      }

      const tagIdsDoItem: string[] = serieId ? [] : [...tagIdsSerieOuItem]
      if (row.tags_extra?.trim()) {
        for (const nomeTag of row.tags_extra.split(';').map((s) => s.trim()).filter(Boolean)) {
          tagIdsDoItem.push(await resolverTag(nomeTag, 'outro'))
        }
      }

      const { data: item, error: itemError } = await supabase
        .from('itens')
        .insert({
          user_id: user.id,
          serie_id: serieId,
          titulo,
          numero_volume: numeroVolume,
          tipo,
          isbn: row.isbn?.trim() || null,
          estado,
          observacoes: row.observacoes?.trim() || null,
        })
        .select('id')
        .single()
      if (itemError) throw new Error(itemError.message)

      if (tagIdsDoItem.length > 0) {
        const linksItem = tagIdsDoItem.map((tag_id) => ({ item_id: item.id, tag_id }))
        await supabase.from('item_tags').insert(linksItem)
      }

      resumo.itensCriados++

      let capaAplicada = false

      if (row.isbn?.trim()) {
        const resultado = await buscarCapaPorIsbn(row.isbn.trim())
        if (resultado) {
          const path = await baixarEPersistirCapa(supabase, user.id, item.id, resultado.url)
          if (path) {
            await supabase.from('itens').update({ capa_url: path, capa_origem: 'api' }).eq('id', item.id)
            resumo.capasAplicadas++
            capaAplicada = true
            if (serieId) {
              await supabase
                .from('series')
                .update({
                  busca_termo: row.serie?.trim() || titulo,
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
          const path = await baixarEPersistirCapa(supabase, user.id, item.id, candidato.url)
          if (path) {
            await supabase.from('itens').update({ capa_url: path, capa_origem: 'api' }).eq('id', item.id)
            resumo.capasAplicadas++
          }
        }
      }
    } catch (e) {
      resumo.erros.push({ linha: i + 2, motivo: e instanceof Error ? e.message : 'erro desconhecido' })
    }
  }

  revalidatePath('/colecao')
  revalidatePath('/desejos')
  revalidatePath('/series')
  revalidatePath('/tags')

  return resumo
}
