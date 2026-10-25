import { z } from 'zod'
import { parseNumeroPtBr } from '@/lib/numeros'
import type { EstadoItem, TipoObra } from '@/lib/types'

/** Linhas por chamada ao servidor: cada linha custa ~6 consultas (e, com ISBN, uma busca de capa). */
export const LINHAS_POR_LOTE = 15
/** Teto do arquivo inteiro; acima disso é quase certamente o arquivo errado. */
export const MAX_LINHAS_CSV = 3000

export const COLUNAS_CSV = [
  'titulo',
  'serie',
  'numero_volume',
  'tipo',
  'estado',
  'editora',
  'universo',
  'personagem',
  'selo',
  'autor',
  'isbn',
  'tags_extra',
  'observacoes',
] as const

const texto = (max: number) => z.string().max(max, `texto longo demais (máximo ${max} caracteres)`).optional()

/** Uma linha do CSV como chega do navegador: tudo texto, com tetos de tamanho. */
export const linhaCsvSchema = z.object({
  titulo: texto(200),
  serie: texto(200),
  numero_volume: texto(20),
  tipo: texto(30),
  estado: texto(30),
  editora: texto(80),
  universo: texto(80),
  personagem: texto(80),
  selo: texto(80),
  autor: texto(80),
  isbn: texto(20),
  tags_extra: texto(500),
  observacoes: texto(2000),
})

export type LinhaCsv = z.infer<typeof linhaCsvSchema>

/** Minúsculas, sem acento e sem espaços nas pontas: "Mangá " → "manga". */
export function normalizarChave(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
}

const TIPOS: Record<string, TipoObra> = {
  hq: 'hq',
  hqs: 'hq',
  quadrinho: 'hq',
  quadrinhos: 'hq',
  comic: 'hq',
  comics: 'hq',
  manga: 'manga',
  mangas: 'manga',
}

const ESTADOS: Record<string, EstadoItem> = {
  desejo: 'desejo',
  desejos: 'desejo',
  wishlist: 'desejo',
  comprado: 'comprado',
  comprada: 'comprado',
  tenho: 'comprado',
  adquirido: 'comprado',
  lido: 'lido',
  lida: 'lido',
}

/** Vazio vira `hq` (padrão histórico); valor desconhecido devolve `null` para a linha ser recusada, não adivinhada. */
export function normalizarTipo(bruto: string | undefined): TipoObra | null {
  const chave = normalizarChave(bruto ?? '')
  if (!chave) return 'hq'
  return TIPOS[chave] ?? null
}

/** Vazio vira `comprado` (padrão histórico); valor desconhecido devolve `null`. */
export function normalizarEstado(bruto: string | undefined): EstadoItem | null {
  const chave = normalizarChave(bruto ?? '')
  if (!chave) return 'comprado'
  return ESTADOS[chave] ?? null
}

/** `ok: false` quando há texto que não é número (para não gravar `null` e duplicar na reimportação). */
export function normalizarNumeroVolume(bruto: string | undefined): { ok: true; valor: number | null } | { ok: false } {
  const t = (bruto ?? '').trim()
  if (!t) return { ok: true, valor: null }
  const n = parseNumeroPtBr(t)
  return n === null ? { ok: false } : { ok: true, valor: n }
}

/** Cabeçalho tolerante: BOM, caixa, acento e espaços não impedem de reconhecer a coluna. */
export function normalizarCabecalho(cabecalho: string): string {
  return normalizarChave(cabecalho.replace(/^﻿/, '')).replace(/\s+/g, '_')
}
