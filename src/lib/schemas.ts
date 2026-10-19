import { z } from 'zod'

export const tipoObraSchema = z.enum(['hq', 'manga'])
export const estadoItemSchema = z.enum(['desejo', 'comprado', 'lido'])
export const tipoTagSchema = z.enum([
  'personagem',
  'editora',
  'arco',
  'selo',
  'autor',
  'universo',
  'outro',
])

export const tagInputSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório').max(80),
  tipo: tipoTagSchema,
  cor: z.string().trim().max(20).optional().nullable(),
})

export const serieInputSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório').max(200),
  tipo: tipoObraSchema.default('hq'),
  total_volumes: z.coerce.number().int().positive().optional().nullable(),
  em_publicacao: z.coerce.boolean().default(true),
  tem_numeracao: z.coerce.boolean().default(false),
  observacoes: z.string().trim().max(2000).optional().nullable(),
  tagIds: z.array(z.string().uuid()).default([]),
})

export const itemInputSchema = z.object({
  titulo: z.string().trim().min(1, 'Título obrigatório').max(200),
  serie_id: z.string().uuid().optional().nullable(),
  numero_volume: z.coerce.number().optional().nullable(),
  tipo: tipoObraSchema.default('hq'),
  isbn: z.string().trim().max(20).optional().nullable(),
  estado: estadoItemSchema.default('desejo'),
  prioridade: z.coerce.number().int().default(0),
  preco: z.coerce.number().nonnegative().optional().nullable(),
  loja: z.string().trim().max(120).optional().nullable(),
  data_aquisicao: z.string().optional().nullable(),
  nota: z.coerce.number().int().min(1).max(5).optional().nullable(),
  observacoes: z.string().trim().max(2000).optional().nullable(),
  tagIds: z.array(z.string().uuid()).default([]),
})

/** Vincular/desvincular vários itens de uma série de uma vez. */
export const itensDaSerieSchema = z.object({
  serieId: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos um item').max(500),
})

/** Inclusão de itens numa série levando junto o número de cada volume.
 *  `numero` é nulo quando a série não é numerada — aí o valor é simplesmente ignorado. */
export const itensComNumeroSchema = z.object({
  serieId: z.string().uuid(),
  itens: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        numero: z.number().finite().nullable(),
      })
    )
    .min(1, 'Selecione ao menos um item')
    .max(500),
})

export const adquirirInputSchema = z.object({
  preco: z.coerce.number().nonnegative().optional().nullable(),
  loja: z.string().trim().max(120).optional().nullable(),
  data_aquisicao: z.string().optional().nullable(),
})

/** Marcar aquisição de vários itens da lista de desejos de uma vez.
 *  `preco` é UNITÁRIO: o mesmo valor é gravado em cada item do lote. */
export const adquirirLoteSchema = adquirirInputSchema.extend({
  itemIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos um item').max(500),
})

/** Criação de vários volumes de uma série de uma vez ("comprei do 1 ao 3 e do 5 ao 7").
 *  O teto de 200 é o mesmo do parser de faixas — lote maior que isso é engano de digitação. */
export const criarVolumesInputSchema = z.object({
  serieId: z.string().uuid(),
  numeros: z
    .array(z.number().int().positive())
    .min(1, 'Informe ao menos um volume')
    .max(200, 'No máximo 200 volumes por vez'),
  estado: estadoItemSchema.default('comprado'),
  prioridade: z.coerce.number().int().default(0),
  preco: z.coerce.number().nonnegative().optional().nullable(),
  loja: z.string().trim().max(120).optional().nullable(),
  data_aquisicao: z.string().optional().nullable(),
  tagIds: z.array(z.string().uuid()).default([]),
})

export type TagInput = z.infer<typeof tagInputSchema>
export type ItensDaSerieInput = z.infer<typeof itensDaSerieSchema>
export type ItensComNumeroInput = z.infer<typeof itensComNumeroSchema>
export type SerieInput = z.infer<typeof serieInputSchema>
export type ItemInput = z.infer<typeof itemInputSchema>
export type AdquirirInput = z.infer<typeof adquirirInputSchema>
export type AdquirirLoteInput = z.infer<typeof adquirirLoteSchema>
export type CriarVolumesInput = z.infer<typeof criarVolumesInputSchema>

/** Candidato de capa vindo do cliente: tudo é re-validado, a URL ainda passa pela allowlist de hosts no download. */
export const candidatoCapaSchema = z.object({
  url: z.string().url().max(1000),
  label: z.string().max(300).default(''),
  provedor: z.enum(['google_books', 'open_library', 'anilist', 'mangadex']),
  ref: z.string().max(64).regex(/^[A-Za-z0-9-]+$/).nullish(),
})
